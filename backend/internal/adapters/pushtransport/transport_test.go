package pushtransport

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNotificationEndpointsExcludePrivateAddresses(t *testing.T) {
	for _, endpoint := range []string{
		"", "http://push.example.invalid/path", "https://localhost/path", "https://device.local/path",
		"https://device.localhost/path", "https://internal/path", "https://push.example.invalid:8443/path",
		"https://user:pass@push.example.invalid/path", "https://push.example.invalid/path#fragment",
		"https://0.0.0.0/path", "https://127.0.0.1/path", "https://10.0.0.1/path",
		"https://172.16.0.1/path", "https://192.168.1.1/path", "https://169.254.169.254/path",
		"https://100.64.0.1/path", "https://192.0.2.1/path", "https://198.18.0.1/path",
		"https://203.0.113.1/path", "https://240.0.0.1/path", "https://224.0.0.1/path",
		"https://[::1]/path", "https://[fc00::1]/path", "https://[fe80::1]/path",
		"https://[::ffff:127.0.0.1]/path", "https://[64:ff9b::7f00:1]/path",
		"https://[2002:7f00:1::]/path", "https://[2001:db8::1]/path",
		"https://[fe80::1%25eth0]/path", " https://push.example.invalid/path",
		"https://push.example.invalid/" + strings.Repeat("a", 2048),
	} {
		t.Run(endpoint, func(t *testing.T) {
			if ValidEndpoint(endpoint) {
				t.Fatal("unsafe notification endpoint was accepted")
			}
		})
	}
	for _, endpoint := range []string{"https://push.example.invalid/path?opaque=value", "https://8.8.8.8:443/path", "https://[2606:4700:4700::1111]/path"} {
		if !ValidEndpoint(endpoint) {
			t.Fatal("public HTTPS endpoint was rejected")
		}
	}
}

func TestNotificationDialPinsValidatedAddressesWithFallback(t *testing.T) {
	lookups := 0
	var targets []string
	lookup := func(ctx context.Context, network, host string) ([]netip.Addr, error) {
		lookups++
		if host != "push.example.invalid" || network != "ip" {
			t.Fatal("unexpected resolver target")
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 10*time.Second {
			t.Fatal("DNS lookup was not bounded")
		}
		return []netip.Addr{netip.MustParseAddr("2606:4700:4700::1111"), netip.MustParseAddr("8.8.8.8")}, nil
	}
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	dial := func(ctx context.Context, network, target string) (net.Conn, error) {
		targets = append(targets, target)
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 3*time.Second {
			t.Fatal("connection attempt was not bounded")
		}
		if len(targets) == 1 {
			return nil, errors.New("IPv6 unavailable")
		}
		return client, nil
	}
	connection, err := dialNotification(t.Context(), "tcp", "push.example.invalid:443", lookup, dial)
	if err != nil || connection != client || lookups != 1 || !reflect.DeepEqual(targets, []string{"[2606:4700:4700::1111]:443", "8.8.8.8:443"}) {
		t.Fatalf("validated fallback failed: lookups=%d targets=%v err=%v", lookups, targets, err)
	}
}

func TestNotificationDialRejectsMixedDNSBeforeConnecting(t *testing.T) {
	for _, unsafe := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::ffff:192.168.1.1"} {
		t.Run(unsafe, func(t *testing.T) {
			lookup := func(context.Context, string, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr(unsafe)}, nil
			}
			dial := func(context.Context, string, string) (net.Conn, error) {
				t.Fatal("a mixed public/private DNS answer reached the network")
				return nil, nil
			}
			_, err := dialNotification(t.Context(), "tcp", "push.example.invalid:443", lookup, dial)
			if !errors.Is(err, errNotificationAddress) {
				t.Fatal("mixed DNS answer was accepted")
			}
		})
	}
	client := NewClient()
	transport := client.Transport.(*http.Transport)
	if transport.Proxy != nil || !transport.DisableKeepAlives || client.Timeout != 10*time.Second || client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("push transport must disable proxies, redirects and connection reuse, with a deadline")
	}
}
