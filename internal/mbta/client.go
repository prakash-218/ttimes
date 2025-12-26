package mbta

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const baseURL = "https://api-v3.mbta.com"

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

type Stop struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Distance  float64 `json:"distance,omitempty"`
}

type stopResponse struct {
	Data []struct {
		ID         string `json:"id"`
		Attributes struct {
			Name      string  `json:"name"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"attributes"`
	} `json:"data"`
}

func (c *Client) GetNearestStops(lat, lon float64) ([]Stop, error) {
	u, _ := url.Parse(fmt.Sprintf("%s/stops", baseURL))
	q := u.Query()
	q.Set("filter[latitude]", fmt.Sprintf("%f", lat))
	q.Set("filter[longitude]", fmt.Sprintf("%f", lon))
	q.Set("filter[radius]", "0.02")
	q.Set("sort", "distance")
	q.Set("page[limit]", "40")
	q.Set("filter[route_type]", "0,1,2,3,4")

	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	if c.apiKey != "" {
		req.Header.Set("x-api-key", c.apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MBTA API returned status: %d", resp.StatusCode)
	}

	var apiResp stopResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, err
	}

	var stops []Stop
	for _, item := range apiResp.Data {
		stops = append(stops, Stop{
			ID:        item.ID,
			Name:      item.Attributes.Name,
			Latitude:  item.Attributes.Latitude,
			Longitude: item.Attributes.Longitude,
		})
	}
	return stops, nil
}

type Prediction struct {
	StopID        string    `json:"stop_id"`
	DepartureTime time.Time `json:"departure_time"`
	Status        string    `json:"status"`
	RouteID       string    `json:"route_id"`
	RouteType     int       `json:"route_type"`
	RouteColor    string    `json:"route_color"`
	DirectionID   int       `json:"direction_id"`
	Headsign      string    `json:"headsign"`
}

type predictionResponse struct {
	Data []struct {
		Attributes struct {
			DepartureTime string `json:"departure_time"`
			Status        string `json:"status"`
			DirectionID   int    `json:"direction_id"`
		} `json:"attributes"`
		Relationships struct {
			Route struct {
				Data struct {
					ID string `json:"id"`
				} `json:"data"`
			} `json:"route"`
			Stop struct {
				Data struct {
					ID string `json:"id"`
				} `json:"data"`
			} `json:"stop"`
			Trip struct {
				Data struct {
					ID string `json:"id"`
				} `json:"data"`
			} `json:"trip"`
		} `json:"relationships"`
	} `json:"data"`
	Included []struct {
		Type       string `json:"type"`
		ID         string `json:"id"`
		Attributes struct {
			Color          string   `json:"color"`
			TextColor      string   `json:"text_color"`
			Description    string   `json:"description"`
			Type           int      `json:"type"`
			Headsign       string   `json:"headsign"`
			DirectionNames []string `json:"direction_names"`
		} `json:"attributes"`
	} `json:"included"`
}

func (c *Client) GetPredictions(stopIDs []string) (map[string][]Prediction, error) {
	if len(stopIDs) == 0 {
		return nil, nil
	}
	u, _ := url.Parse(fmt.Sprintf("%s/predictions", baseURL))
	q := u.Query()
	q.Set("filter[stop]", strings.Join(stopIDs, ","))
	q.Set("sort", "departure_time")
	q.Set("page[limit]", "100")
	q.Set("include", "route,trip")

	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	if c.apiKey != "" {
		req.Header.Set("x-api-key", c.apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MBTA API returned status: %d", resp.StatusCode)
	}

	var apiResp predictionResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, err
	}

	routeColors := make(map[string]string)
	routeTypes := make(map[string]int)
	routeDestinations := make(map[string][]string)
	tripHeadsigns := make(map[string]string)

	for _, inc := range apiResp.Included {
		if inc.Type == "route" {
			routeColors[inc.ID] = inc.Attributes.Color
			routeTypes[inc.ID] = inc.Attributes.Type
			routeDestinations[inc.ID] = inc.Attributes.DirectionNames
		}
		if inc.Type == "trip" {
			tripHeadsigns[inc.ID] = inc.Attributes.Headsign
		}
	}

	predictions := make(map[string][]Prediction)
	for _, item := range apiResp.Data {
		if item.Attributes.DepartureTime == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, item.Attributes.DepartureTime)
		if err != nil {
			continue
		}

		stopID := item.Relationships.Stop.Data.ID
		routeID := item.Relationships.Route.Data.ID
		tripID := item.Relationships.Trip.Data.ID

		headsign := tripHeadsigns[tripID]
		if headsign == "" {
			dirs := routeDestinations[routeID]
			if item.Attributes.DirectionID >= 0 && item.Attributes.DirectionID < len(dirs) {
				headsign = dirs[item.Attributes.DirectionID]
			}
		}

		predictions[stopID] = append(predictions[stopID], Prediction{
			StopID:        stopID,
			DepartureTime: t,
			Status:        item.Attributes.Status,
			RouteID:       routeID,
			DirectionID:   item.Attributes.DirectionID,
			RouteColor:    routeColors[routeID],
			RouteType:     routeTypes[routeID],
			Headsign:      headsign,
		})
	}

	for k := range predictions {
		sort.Slice(predictions[k], func(i, j int) bool {
			return predictions[k][i].DepartureTime.Before(predictions[k][j].DepartureTime)
		})
	}

	return predictions, nil
}
