package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Bind                  string        `yaml:"bind"`
	Port                  int           `yaml:"port"`
	Token                 string        `yaml:"token"`
	Workdirs              []string      `yaml:"workdirs"`
	ScrollbackDir         string        `yaml:"scrollback_dir"`
	ScrollbackDumpInterval string       `yaml:"scrollback_dump_interval"`
	HistoryLimit          int           `yaml:"history_limit"`
}

func (c *Config) GetDumpInterval() time.Duration {
	if c.ScrollbackDumpInterval == "" {
		return 30 * time.Second
	}
	d, err := time.ParseDuration(c.ScrollbackDumpInterval)
	if err != nil {
		return 30 * time.Second
	}
	return d
}

func (c *Config) GetScrollbackDir() string {
	if c.ScrollbackDir == "" {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".claude-dashboard", "scrollback")
	}
	dir := c.ScrollbackDir
	if len(dir) > 0 && dir[0] == '~' {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, dir[1:])
	}
	return dir
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
		Port:                   9100,
		Token:                  "",
		Workdirs:               []string{},
		ScrollbackDumpInterval: "30s",
		HistoryLimit:           50000,
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
