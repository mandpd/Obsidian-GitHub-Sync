# GitHub Page Sync

Sync individual Obsidian notes to specific GitHub repositories and file paths using the GitHub API.

![](screenshots/ribbon-button.png)

## Motivation

This is NOT the excellent Obsidian Vault to Github sync plugin written by Kevin Chin (that this was a fork from).
This plugin is designed to let you sync individual pages in your vault to individual files in potentially different Github repos.
I wanted this functionality because I use Obsidian to track my actions on different projects that are linked to different Github repositories.
The repos contain other information that is not in Obsidian, but any content that I updated regularly and is text based is much more easily managed in Obsidian. If, like me, you want to track your activities fro one portal - an Obsidian Vault - but have those activites sync'ed to many different Github repos, then this plugin is for you! 

## How to Use

This plugin allows you to sync individual notes to GitHub files. Each note can be configured to sync to a different repository and location.

### Setting up sync targets

1. Right-click on a note in the file explorer or editor
2. Select **Set GitHub sync target**
3. Paste a GitHub file URL such as `https://github.com/user/repo/blob/main/docs/file.md`
4. Click **Save target**

### Syncing your notes

Click the **Sync to GitHub** ribbon icon (or use the command palette) to sync all notes that have configured GitHub sync targets. The plugin will:
- Upload the current content of each targeted note to its configured GitHub location
- Create or update the file as needed
- Show a summary of successful and failed syncs

## Setup

### Prerequisites

You need a GitHub personal access token to use this plugin:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" (classic or fine-grained)
3. For classic tokens, grant the `repo` scope
4. For fine-grained tokens, grant `Contents: Read and write` permission
5. Copy your token

### Configuring the plugin

1. Open Obsidian Settings → Community plugins → GitHub Page Sync
2. Paste your GitHub personal access token in the settings
3. (Optional) Enable "Auto sync on startup" to sync all targeted files when Obsidian opens
4. (Optional) Set an "Auto sync at interval" to sync regularly (in minutes)

You can view all your configured sync targets in the "Configured Sync Targets" table at the bottom of the plugin settings.

## How it works

- Each note can have its own GitHub sync target (repository and file path)
- Syncing only affects notes that have been configured with a target
- The GitHub API is used to create or update files, so no local Git installation is required
- Your GitHub personal access token is stored locally in your Obsidian plugin data
