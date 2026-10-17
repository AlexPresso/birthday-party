package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var errNotificationAddress = errors.New("notification endpoint is not a public HTTPS address")

var privateNotificationNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
}

func publicNotificationAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	if address.Is6() && !netip.MustParsePrefix("2000::/3").Contains(address) {
		return false
	}
	for _, network := range privateNotificationNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return true
}

func validNotificationEndpoint(endpoint string) bool {
	if endpoint == "" || len(endpoint) > 2048 || strings.TrimSpace(endpoint) != endpoint {
		return false
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.Contains(host, "%") {
		return false
	}
	if address, err := netip.ParseAddr(host); err == nil {
		return publicNotificationAddress(address)
	}
	return strings.Contains(host, ".")
}

func newNotificationClient() *http.Client {
	transport := &http.Transport{
		Proxy:                  nil,
		DisableKeepAlives:      true,
		DisableCompression:     true,
		MaxConnsPerHost:        1,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  8 * time.Second,
		MaxResponseHeaderBytes: 16 << 10,
		DialContext: func(ctx context.Context, network, target string) (net.Conn, error) {
			return dialNotification(ctx, network, target, net.DefaultResolver.LookupNetIP, (&net.Dialer{}).DialContext)
		},
	}
	return &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func dialNotification(ctx context.Context, network, target string,
	lookup func(context.Context, string, string) ([]netip.Addr, error),
	dial func(context.Context, string, string) (net.Conn, error),
) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	host, port, err := net.SplitHostPort(target)
	if err != nil || port != "443" {
		return nil, errNotificationAddress
	}
	addresses, err := lookup(ctx, "ip", host)
	if err != nil || len(addresses) == 0 || len(addresses) > 16 {
		return nil, errNotificationAddress
	}
	for _, address := range addresses {
		if !publicNotificationAddress(address) {
			return nil, errNotificationAddress
		}
	}
	// Validate the whole DNS answer, then pin every attempt to an address from
	// that answer. TLS still verifies the original host; IPv4 can follow IPv6.
	for _, address := range addresses {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		attempt, cancel := context.WithTimeout(ctx, 3*time.Second)
		connection, dialErr := dial(attempt, network, net.JoinHostPort(address.String(), port))
		cancel()
		if dialErr == nil {
			return connection, nil
		}
	}
	return nil, errNotificationAddress
}
