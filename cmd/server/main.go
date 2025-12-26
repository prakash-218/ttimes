package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/prakash-218/ttimes/internal/service"
)

func main() {
	mbtaKey := os.Getenv("MBTA_API_KEY")
	orsKey := os.Getenv("ORS_API_KEY")

	svc := service.WithOptions(
		service.WithRouter(gin.Default()),
		service.WithPort(":8080"),
		service.WithMBTAKey(mbtaKey),
		service.WithORSKey(orsKey),
	)
	if err := svc.Run(); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
