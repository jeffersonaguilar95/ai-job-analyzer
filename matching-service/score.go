package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

const defaultModel = anthropic.ModelClaudeOpus5

// scoreSchema constrains the model's response via output_config.format, so
// the returned text is guaranteed to be valid JSON matching this shape —
// no tool_use round-trip needed.
var scoreSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"score": map[string]any{
			"type":        "integer",
			"description": "Match score from 0 (no fit) to 100 (excellent fit) between the CV and this job posting.",
		},
		"reasoning": map[string]any{
			"type":        "string",
			"description": "2-4 sentences covering relevant experience, matching/missing technologies, and seniority fit.",
		},
	},
	"required":             []string{"score", "reasoning"},
	"additionalProperties": false,
}

type scorer struct {
	client   anthropic.Client
	cvBase64 string
	model    string
}

func newScorer(cvBase64, model string) *scorer {
	if model == "" {
		model = defaultModel
	}
	return &scorer{
		client:   anthropic.NewClient(), // reads ANTHROPIC_API_KEY from the environment
		cvBase64: cvBase64,
		model:    model,
	}
}

type analyzeRequest struct {
	Title   string `json:"title"`
	Company string `json:"company"`
	Text    string `json:"text"`
}

type analyzeResponse struct {
	Score     *int   `json:"score"`
	Reasoning string `json:"reasoning"`
}

type scoreResult struct {
	Score     int    `json:"score"`
	Reasoning string `json:"reasoning"`
}

func (s *scorer) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	var req analyzeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	if req.Text == "" {
		http.Error(w, `"text" is required`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	result, err := s.score(ctx, req)
	if err != nil {
		log.Printf("score error: %v", err)
		http.Error(w, "scoring failed", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func (s *scorer) score(ctx context.Context, req analyzeRequest) (analyzeResponse, error) {
	prompt := fmt.Sprintf(
		"Job title: %s\nCompany: %s\n\nJob posting:\n%s\n\nCompare this job posting against the attached CV. Consider relevant experience, matching and missing technologies, and seniority fit. Return a score from 0 to 100 and a brief reasoning.",
		req.Title, req.Company, req.Text,
	)

	resp, err := s.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     s.model,
		MaxTokens: 4096,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortMedium,
			Format: anthropic.JSONOutputFormatParam{Schema: scoreSchema},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewDocumentBlock(anthropic.Base64PDFSourceParam{Data: s.cvBase64}),
				anthropic.NewTextBlock(prompt),
			),
		},
	})
	if err != nil {
		return analyzeResponse{}, fmt.Errorf("anthropic request failed: %w", err)
	}

	if resp.StopReason == anthropic.StopReasonRefusal {
		return analyzeResponse{Reasoning: fmt.Sprintf("Request declined by safety classifiers (%s).", resp.StopDetails.Category)}, nil
	}

	for _, block := range resp.Content {
		if block.Type == "text" {
			var result scoreResult
			if err := json.Unmarshal([]byte(block.Text), &result); err != nil {
				return analyzeResponse{}, fmt.Errorf("failed to parse structured output: %w", err)
			}
			score := result.Score
			return analyzeResponse{Score: &score, Reasoning: result.Reasoning}, nil
		}
	}

	return analyzeResponse{}, fmt.Errorf("no text content in response (stop_reason=%s)", resp.StopReason)
}
