package main

import (
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"time"
)

type config struct {
	port     string
	cvBase64 string
	model    string
}

func loadConfig() config {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		log.Fatal("ANTHROPIC_API_KEY is not set")
	}

	cvPath := os.Getenv("CV_PATH")
	if cvPath == "" {
		log.Fatal("CV_PATH is not set (path to your CV PDF)")
	}
	cvBytes, err := os.ReadFile(cvPath)
	if err != nil {
		log.Fatalf("failed to read CV at %s: %v", cvPath, err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8787"
	}

	return config{
		port:     port,
		cvBase64: base64.StdEncoding.EncodeToString(cvBytes),
		model:    os.Getenv("ANTHROPIC_MODEL"),
	}
}

func main() {
	cfg := loadConfig()
	s := newScorer(cfg.cvBase64, cfg.model)

	mux := http.NewServeMux()
	mux.HandleFunc("POST /analyze", s.handleAnalyze)

	server := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("matching-service listening on :%s (model: %s)", cfg.port, s.model)
	log.Fatal(server.ListenAndServe())
}
