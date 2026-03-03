# Terminal Bell Notes

## Chromebook (hterm)

Set custom bell sound (paste in browser DevTools console on hterm):

    term_.prefs_.set('audible-bell-sound', 'https://YOUR-HOST/default.wav')

Disable:

    term_.prefs_.set('audible-bell-sound', '')

Host the WAV file on a URL accessible from the Chromebook
(e.g. Tailscale serve, Cloudflare tunnel).
