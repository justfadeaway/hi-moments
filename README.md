# Hi Moments

Hi Moments is a private, consent-first people diary for Hirey Hi. It combines fast photo, video, voice, and note capture with a deliberate multi-person review flow.

## Product principles

- Media and private notes stay in the browser's IndexedDB by default.
- Face detection, when available, runs on device and only locates visible faces.
- The app never performs 1:N face search against the Hi network.
- A detected appearance is not a person, and a local person is not a Hi profile.
- Existing Hi profiles are linked only after a user searches by text and confirms the result.
- Unknown people remain private until they explicitly claim a profile.
- The invitation gate requires the recorder to attest that the person knows and agreed to receive it.
- Your card defines who is sending an invitation, stays local by default, and shares optional contact details only with an explicit toggle.

## Current prototype

The static web prototype includes:

- Phone camera capture and photo/video library upload.
- Voice or text-only moments.
- On-device IndexedDB persistence for media, moments, and people.
- Native `FaceDetector` support when exposed by the browser, with manual labeling fallback.
- A multi-person media review screen.
- Local people diary and lifecycle states.
- Text-based Hi profile search with manual confirmation.
- Consent-gated invitation preparation.
- A local sender card for name, headline, phone, email, X, website, and LinkedIn, ready for optional Hi profile sync.
- Media retention controls and one-click local deletion.

Hi authentication and the final server-issued invitation/claim token are intentionally represented as production integration boundaries. The prototype does not pretend a local link is a completed claim.

## Run locally

```sh
python3 -m http.server 4180
```

Open `http://127.0.0.1:4180/`.

## License

MIT
