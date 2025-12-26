package ors

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const baseURL = "https://api.openrouteservice.org/v2/matrix"

type Client struct {
	apiKey string
	client *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type matrixRequest struct {
	Locations    [][]float64 `json:"locations"`
	Sources      []int       `json:"sources"`
	Destinations []int       `json:"destinations"`
	Metrics      []string    `json:"metrics"`
}

type matrixResponse struct {
	Durations [][]float64 `json:"durations"`
}

func (c *Client) GetWalkingTimes(origin []float64, destinations [][]float64) ([]float64, error) {
	if len(destinations) == 0 {
		return nil, nil
	}

	locations := make([][]float64, 0, 1+len(destinations))
	locations = append(locations, origin)
	locations = append(locations, destinations...)

	sources := []int{0}
	destIDs := make([]int, len(destinations))
	for i := range destinations {
		destIDs[i] = i + 1
	}

	reqBody := matrixRequest{
		Locations:    locations,
		Sources:      sources,
		Destinations: destIDs,
		Metrics:      []string{"duration"},
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/foot-walking", baseURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ORS API returned status: %d", resp.StatusCode)
	}

	var apiResp matrixResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, err
	}

	if len(apiResp.Durations) == 0 || len(apiResp.Durations[0]) != len(destinations) {
		return nil, fmt.Errorf("unexpected response format from ORS")
	}

	return apiResp.Durations[0], nil
}
