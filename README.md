# Birthday Party

A small app made for my 30th birthday, feel free to host and use it too, it was
designed to be modular, reusable and highly customizable!

<p align="center">
  <img src="docs/screenshots/invitation.webp" width="32%" alt="Invitation page: a large 30 in an orange ring, the date, the place with its map link, the host's note and an Enter button">
  <img src="docs/screenshots/gallery.webp" width="32%" alt="Shared gallery: a mosaic of party photos, each with its author">
  <img src="docs/screenshots/schedule.webp" width="32%" alt="Schedule: an open vote at the top, then the evening's events by day">
</p>

## What's in it

- A shared gallery for everyone's photos and videos, with a slideshow.
- The schedule of the evening, with surprises that appear at their time.
- Votes, an anonymous question game, and a werewolf game where each player
  finds their role on their phone.
- A guestbook and a page for practical details.
- Settings for the host: guests and their links, the schedule, a welcome before
  the party opens, and the look of the app.

<p align="center">
  <img src="docs/screenshots/vote.webp" width="32%" alt="A vote on guests, with their photos and live counts">
  <img src="docs/screenshots/no-filter.webp" width="32%" alt="No Filter as the host: anonymous questions ranked by upvotes, with the answered and joker actions">
  <img src="docs/screenshots/werewolf-role.webp" width="32%" alt="Werewolf at night: a player's own role and the list of the dead">
</p>

<p align="center">
  <img src="docs/screenshots/settings.webp" width="32%" alt="Settings: party, schedule, welcome, guests, invitation and media">
  <img src="docs/screenshots/werewolf-master.webp" width="32%" alt="The game master's board: every role, the mayor and the dead">
  <img src="docs/screenshots/gallery-light.webp" width="32%" alt="The same gallery in the light theme with a blue accent">
</p>

There are no accounts: the host adds guests and sends each one their link. The
app follows the phone's language (French, English, German, Italian or Spanish),
and the photos and messages stay on the server it runs on.

<sub>The screenshots show a made-up party; its photos and portraits come from <a href="https://unsplash.com">Unsplash</a>.</sub>

## Trying it

With Docker:

```sh
git clone https://github.com/AlexPresso/birthday-party.git
cd birthday-party
docker compose up -d
docker compose logs backend
```

The logs show an `Administrator invitation:` link; open it to become the host
of an empty party at http://localhost:3000. Putting it online and working on
the code are covered in the [development guide](docs/development.md).

## Licence

[AGPL-3.0-only](LICENSE). The bundled fonts and icons keep their own licences,
listed in the [development guide](docs/development.md#third-party-material).
