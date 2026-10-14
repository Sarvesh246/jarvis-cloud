# Jarvis Cloud

Use Jarvis from my phone without leaving my PC running.

This repository is for a separate cloud deployment of [Hermes Agent](https://github.com/NousResearch/hermes-agent), connected to the Jarvis web interface. Keeping it separate means the local setup remains available if cloud hosting stops working. Computer access, local Ollama models and heavier rendering stay on the PC.

The first target is Render's free web service, with the interface on Vercel. This is the initial scaffold; the backend, authentication and persistent storage still need to be set up. There isn't a runnable service yet.

Provider accounts will be shared with local Jarvis, so their usage limits won't increase. Keys belong in the host's environment settings, never in this repository.
