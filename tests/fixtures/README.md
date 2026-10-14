# Video fixture

`party-video.mp4` contains three seconds of a generated test pattern and tone.
It contains no guest content. Browser tests upload it through the public API,
then verify thumbnail delivery, playback, ranged reads, downloads and deletion.

Regenerate it with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=16:duration=3 -f lavfi -i sine=frequency=880:sample_rate=44100:duration=3 -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -c:a aac -b:a 48k -movflags +faststart -shortest tests/fixtures/party-video.mp4
```
