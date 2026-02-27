package main

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Bind         string   `yaml:"bind"`
	Port         int      `yaml:"port"`
	Token        string   `yaml:"token"`
	Workdirs     []string `yaml:"workdirs"`
	HistoryLimit int      `yaml:"history_limit"`
}

func (c *Config) ExpandWorkdirs() []string {
	var expanded []string
	for _, d := range c.Workdirs {
		if len(d) > 0 && d[0] == '~' {
			home, _ := os.UserHomeDir()
			d = filepath.Join(home, d[1:])
		}
		expanded = append(expanded, d)
	}
	return expanded
}

func defaultConfig() *Config {
	return &Config{
		Port:         9100,
		Token:        "",
		Workdirs:     []string{},
		HistoryLimit: 50000,
	}
}

func loadConfig(path string) (*Config, error) {
	cfg := defaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, fmt.Errorf("reading config: %w", err)
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	if cfg.Port == 0 {
		cfg.Port = 9100
	}
	if cfg.HistoryLimit == 0 {
		cfg.HistoryLimit = 50000
	}

	return cfg, nil
}
