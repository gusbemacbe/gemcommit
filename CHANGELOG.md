# Change Log

All notable changes to the "gemcommit" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.8] - 2025-08-16

### Security

- Deprecated the `gemcommit.apiKey` setting. The API key is now read from a `GEMINI_API_KEY` variable in the `~/.env` file to enhance security. The extension will show a warning if the old setting is detected.

## [Unreleased]

- Initial release