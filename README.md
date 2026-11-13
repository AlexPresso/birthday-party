# Birthday Party

A private web app for one birthday party. Guests open a personal link on their
phone, add their photos and videos to a shared gallery, follow the evening's
schedule, vote, ask the host awkward questions and sign the guestbook. The host
runs all of it from a settings screen on the same phone.

It was built for a 30th birthday and is meant to be reused, with one installation
per party. You run it on your own server, so the photos and messages stay with
you.

<p align="center">
  <img src="docs/screenshots/invitation.webp" width="32%" alt="Invitation page: a large 30 in an orange ring, “Inès, you’re invited” and an Enter button">
  <img src="docs/screenshots/gallery.webp" width="32%" alt="Media tab: a mosaic of party photos, each with its author's name and portrait">
  <img src="docs/screenshots/schedule.webp" width="32%" alt="Schedule tab: an open vote at the top, then the evening's events with their times">
</p>

<sub>The screenshots show a made-up party. Its photos and portraits are drawings
generated for the demo.</sub>

## For guests

### A link instead of an account

The host adds each guest by name and sends them a personal link, by whatever
means they like. There is nothing to sign up for and no password to remember.
The guest opens the link, taps **Enter**, and stays signed in on that phone. A
guest who changes phone asks the host for a new link and finds their profile
as they left it.

### Photos and videos

Everyone's photos and videos land in one gallery, each with the name of the
person who added it. Guests can pick a batch of files and keep using the app
while they upload. Videos are kept exactly as they were sent, so a download
gives back the original file.

The host can sort media into categories, which appear as round buttons above
the gallery, and any of them can be played as a slideshow.

<p align="center">
  <img src="docs/screenshots/gallery-desktop.webp" width="97%" alt="The gallery on a computer screen, four columns wide">
</p>

### Schedule and surprises

The schedule lists what happens during the party, in order. The host can keep
an event secret until a chosen time. Until then guests see a teaser at most,
and the rest appears by itself when the moment comes.

### Votes

The host asks a question and decides what people vote on: the guests
themselves, shown with their profile photos, or a list of choices. For a list,
guests can be allowed to add a choice of their own.

Everyone sees all the options and their scores, with the leader on top, and the
ranking moves as votes come in. Each guest has one vote and can change it until
the host closes voting. Nobody can see who voted for what, the host included.

<p align="center">
  <img src="docs/screenshots/vote-guests.webp" width="32%" alt="Vote page: guests listed with their portraits and live scores">
  <img src="docs/screenshots/vote-choices.webp" width="32%" alt="A vote on which song opens the dance floor, with four choices and a field to add another">
  <img src="docs/screenshots/no-filter.webp" width="32%" alt="No Filter page: anonymous questions ranked by upvotes, and two jokers left">
</p>

### No Filter

A question game. Guests send anonymous questions and upvote the ones they want
to hear. The host answers out loud and has two jokers for the whole game to
skip a question. The questions are anonymous for everyone, the host included.

### Guestbook

Guests leave a message, signed or anonymous. An anonymous message hides its
author from the other guests and from the host, and the author can still
delete it.

### In the guest's language

The app follows the phone's language: French, English, German, Italian or
Spanish. Names, messages and event titles stay exactly as people wrote them.

## For the host

The host is a guest with one more tab, **Settings**. From there you:

- set the party's name, age, date and place;
- add guests, copy their links, and replace or withdraw a link when needed. The
  app sends no email and no text message, so you pass the links on yourself;
- write the text of the invitation page, in several languages if you like;
- build the schedule, with its surprises, votes and question games;
- create media categories and decide whether guests can see each of them;
- choose how large a photo or a video may be.

<p align="center">
  <img src="docs/screenshots/settings.webp" width="32%" alt="Settings: party details, schedule, guest welcome, guests and invitations, invitation, categories, upload limits">
  <img src="docs/screenshots/welcome.webp" width="32%" alt="A guest's first welcome step, asking for a profile photo">
  <img src="docs/screenshots/guestbook.webp" width="32%" alt="Guestbook: a message field, a “Post anonymously” checkbox and signed messages">
</p>

### Welcoming guests step by step

Before the party opens, you can walk guests through a few steps that you
compose yourself: a title, a few words, a profile photo, a place to drop photos
and videos, an invitation to turn on notifications, or a list of house rules
that each guest ticks before moving on.

You unlock the steps one at a time when you are ready, and each guest moves
through them at their own pace. A step can collect photos into a category only
you can see, which is a simple way to prepare a surprise album. When you open
the app, everyone can come in.

Guests who turned on notifications get one each time you unlock a step or open
the app. On iPhone and iPad, the app first has to be added to the home screen.

## Privacy

- Only people with a link from the host can get in. Send each link to its guest
  only: until it has been used, it works for whoever opens it.
- Photos, videos and messages are visible to signed-in guests and to nobody
  else.
- Votes, questions and anonymous guestbook messages cannot be traced back to a
  person by anyone using the app.
- Nothing is deleted automatically. The host can remove any contribution, and
  guests can remove their own.

## Try it

With [Docker](https://www.docker.com/) installed:

```sh
git clone https://github.com/AlexPresso/birthday-party.git
cd birthday-party
docker compose up -d
docker compose logs backend
```

The last command shows a line starting with `Administrator invitation:`. Open
that link, tap **Enter**, and you are the host of an empty party at
http://localhost:3000.

This setup is for trying the app on your own computer. To put it online for a
real party, or to work on the code, see the
[development and deployment guide](docs/development.md).

## License

Birthday Party is released under the GNU Affero General Public License, version
3 only (`AGPL-3.0-only`); the full text is in [LICENSE](LICENSE). If you modify
the app and offer it online, the licence asks you to make your modified source
available to its users.

The bundled fonts, icons and agent skills keep their own licences, listed in
the [development guide](docs/development.md#third-party-material).
