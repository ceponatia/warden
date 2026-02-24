# Scheduling Warden runs

## Weekly cron (recommended baseline)

Run collection + analysis every Monday at 09:00:

```cron
0 9 * * 1 cd /path/to/warden && pnpm warden collect && pnpm warden analyze
```

### Cron environment notes

- Cron has a minimal `PATH`; use absolute paths when needed.
- Ensure `.env` is readable from the Warden root (AI provider keys for `warden analyze`).
- If `pnpm` is not found, use the full binary path:

```cron
0 9 * * 1 cd /path/to/warden && /home/user/.local/share/pnpm/pnpm warden collect && /home/user/.local/share/pnpm/pnpm warden analyze
```

## Linux systemd timer (alternative)

`/etc/systemd/system/warden-weekly.service`:

```ini
[Unit]
Description=Run Warden weekly snapshot + analysis

[Service]
Type=oneshot
WorkingDirectory=/path/to/warden
ExecStart=/usr/bin/env pnpm warden collect
ExecStart=/usr/bin/env pnpm warden analyze
```

`/etc/systemd/system/warden-weekly.timer`:

```ini
[Unit]
Description=Weekly Warden timer

[Timer]
OnCalendar=Mon *-*-* 09:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now warden-weekly.timer
```

## macOS launchd (alternative)

`~/Library/LaunchAgents/com.warden.weekly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.warden.weekly</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/sh</string>
      <string>-lc</string>
      <string>cd /path/to/warden && pnpm warden collect && pnpm warden analyze</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Weekday</key>
      <integer>1</integer>
      <key>Hour</key>
      <integer>9</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
```

Load with:

```bash
launchctl load ~/Library/LaunchAgents/com.warden.weekly.plist
```
