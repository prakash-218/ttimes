package service

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prakash-218/ttimes/internal/mbta"
	"github.com/prakash-218/ttimes/internal/ors"
)

const (
	stopsCacheTTL       = 5 * time.Minute
	walkTimesCacheTTL   = 30 * time.Minute
	predictionsCacheTTL = 15 * time.Second
)

type CacheEntry struct {
	Data      interface{}
	ExpiresAt time.Time
}

type Cache struct {
	mu      sync.RWMutex
	entries map[string]CacheEntry
}

func NewCache() *Cache {
	return &Cache{
		entries: make(map[string]CacheEntry),
	}
}

func (c *Cache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry.Data, true
}

func (c *Cache) Set(key string, data interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = CacheEntry{
		Data:      data,
		ExpiresAt: time.Now().Add(ttl),
	}
}

type Server interface {
	Run() error
}

type Option func(*Service)

type Service struct {
	router     *gin.Engine
	port       string
	mbtaClient *mbta.Client
	orsClient  *ors.Client
	cache      *Cache
}

func NewService() Server {
	return &Service{
		router: gin.New(),
	}
}

func WithRouter(router *gin.Engine) Option {
	return func(s *Service) {
		s.router = router
	}
}

func WithPort(port string) Option {
	return func(s *Service) {
		s.port = port
	}
}

func WithMBTAKey(key string) Option {
	return func(s *Service) {
		s.mbtaClient = mbta.NewClient(key)
	}
}

func WithORSKey(key string) Option {
	return func(s *Service) {
		s.orsClient = ors.NewClient(key)
	}
}

func WithOptions(options ...Option) Server {
	s := &Service{
		router: gin.New(),
		cache:  NewCache(),
	}
	for _, option := range options {
		option(s)
	}
	if s.mbtaClient == nil {
		s.mbtaClient = mbta.NewClient("")
	}
	if s.orsClient == nil {
		s.orsClient = ors.NewClient("")
	}
	return s
}

type commuteRequest struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type CommuteOption struct {
	StopName      string    `json:"stop_name"`
	Line          string    `json:"line"`
	Headsign      string    `json:"headsign"`
	RouteColor    string    `json:"route_color"`
	RouteType     int       `json:"route_type"`
	DepartureTime time.Time `json:"departure_time"`
	WalkTimeSec   float64   `json:"walk_time_sec"`
	TimeToLeave   time.Time `json:"time_to_leave"`
	Status        string    `json:"status"`
}

func (s *Service) handleCommute(c *gin.Context) {
	var req commuteRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	log.Printf("Received commute request: Lat=%f, Lon=%f", req.Lat, req.Lon)

	locKey := fmt.Sprintf("loc:%.4f,%.4f", req.Lat, req.Lon)

	stopsKey := "stops:" + locKey
	var stops []mbta.Stop
	if cached, ok := s.cache.Get(stopsKey); ok {
		stops = cached.([]mbta.Stop)
		log.Printf("Cache HIT: Found %d stops from cache", len(stops))
	} else {
		var err error
		stops, err = s.mbtaClient.GetNearestStops(req.Lat, req.Lon)
		if err != nil {
			log.Printf("Error getting stops: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get stops: %v", err)})
			return
		}
		s.cache.Set(stopsKey, stops, stopsCacheTTL)
		log.Printf("Cache MISS: Found %d stops from API", len(stops))
	}

	if len(stops) == 0 {
		c.JSON(http.StatusOK, gin.H{"options": []CommuteOption{}})
		return
	}

	stopIDs := make([]string, len(stops))
	destinations := make([][]float64, len(stops))
	stopMap := make(map[string]mbta.Stop)

	for i, stop := range stops {
		stopIDs[i] = stop.ID
		destinations[i] = []float64{stop.Longitude, stop.Latitude}
		stopMap[stop.ID] = stop
	}

	walkKey := "walk:" + locKey
	var walkTimes []float64
	if cached, ok := s.cache.Get(walkKey); ok {
		walkTimes = cached.([]float64)
		log.Printf("Cache HIT: Walk times from cache")
	} else {
		var err error
		walkTimes, err = s.orsClient.GetWalkingTimes([]float64{req.Lon, req.Lat}, destinations)
		if err != nil {
			log.Printf("Error getting walk times: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get walk times: %v", err)})
			return
		}
		s.cache.Set(walkKey, walkTimes, walkTimesCacheTTL)
		log.Printf("Cache MISS: Walk times from API")
	}

	predsKey := "preds:" + strings.Join(stopIDs, ",")
	var predictions map[string][]mbta.Prediction
	if cached, ok := s.cache.Get(predsKey); ok {
		predictions = cached.(map[string][]mbta.Prediction)
		log.Printf("Cache HIT: Predictions from cache")
	} else {
		var err error
		predictions, err = s.mbtaClient.GetPredictions(stopIDs)
		if err != nil {
			log.Printf("Error getting predictions: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get predictions: %v", err)})
			return
		}
		s.cache.Set(predsKey, predictions, predictionsCacheTTL)
		log.Printf("Cache MISS: Predictions from API (%d stops)", len(predictions))
	}

	var options []CommuteOption
	now := time.Now()

	for i, stopID := range stopIDs {
		preds, ok := predictions[stopID]
		if !ok || len(preds) == 0 {
			log.Printf("No predictions for stop %s", stopID)
			continue
		}

		walkSec := 0.0
		if i < len(walkTimes) {
			walkSec = walkTimes[i]
		}

		stop := stopMap[stopID]

		for _, p := range preds {
			if p.DepartureTime.Before(now) {
				continue
			}

			timeToLeave := p.DepartureTime.Add(-time.Duration(walkSec) * time.Second)

			if timeToLeave.Before(now.Add(-5 * time.Minute)) {
				log.Printf("Skipping %s %s: timeToLeave %v is too late (walk: %f)", stop.Name, p.RouteID, timeToLeave, walkSec)
				continue
			}

			options = append(options, CommuteOption{
				StopName:      stop.Name,
				Line:          toLineName(p.RouteID),
				Headsign:      p.Headsign,
				RouteColor:    p.RouteColor,
				RouteType:     p.RouteType,
				DepartureTime: p.DepartureTime,
				WalkTimeSec:   walkSec,
				TimeToLeave:   timeToLeave,
				Status:        p.Status,
			})
		}
	}

	log.Printf("Returning %d options", len(options))
	c.JSON(http.StatusOK, gin.H{"options": options})
}

func toLineName(routeID string) string {
	if strings.HasPrefix(routeID, "Red") {
		return "RL"
	} else if strings.HasPrefix(routeID, "Green") {
		split := strings.Split(routeID, "-")
		if len(split) > 1 {
			return split[1]
		}
		return "GL"
	} else if strings.HasPrefix(routeID, "Blue") {
		return "BL"
	} else if strings.HasPrefix(routeID, "Orange") {
		return "OL"
	} else if strings.HasPrefix(routeID, "Silver") {
		return "SL"
	}
	return routeID
}

func (s *Service) SetupRoutes() {
	s.router.LoadHTMLGlob("internal/template/html/*")
	s.router.Static("/js", "./internal/template/js")
	s.router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "OK"})
	})

	s.router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", gin.H{
			"title": "TTimes",
		})
	})

	s.router.POST("/api/commute", s.handleCommute)

}

func (s *Service) Run() error {
	s.SetupRoutes()
	return s.router.Run(s.port)
}
