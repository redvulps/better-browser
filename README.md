# Better Browser

Better Browser lets an AI agent work in your Chrome or Brave profile. Each conversation gets its own tab group and can use the accounts you’re already signed in to. Any agent that can launch a Model Context Protocol (MCP) server over `stdio` and call its tools can use Better Browser. The optional skill teaches the agent how to pair with a browser and manage its tabs.

## Download the extension

[Download the latest signed extension (better-browser.crx)](https://github.com/redvulps/better-browser/releases/latest/download/better-browser.crx)

Chrome on Linux supports self-hosted CRX packages. On Windows and macOS, Chrome normally distributes packaged extensions through the Chrome Web Store. To run a developer build, load the unpacked extension using the instructions below. [Chrome distribution guide](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux) · [Build the project](#build-the-project) · [Connect your browser](#connect-your-browser)

When you push a tag such as `v0.3.3` that matches the version in `extension/manifest.json`, GitHub Actions builds the extension, signs the CRX with the `CRX_PRIVATE_KEY` repository secret, and attaches it to the release. For a one-off build, select **Run workflow** on the `main` branch and download the **better-browser-crx** artifact from the run. [Build extension workflow](https://github.com/redvulps/better-browser/actions/workflows/extension.yml)

<a id="instalando-a-skill"></a>

## Installing the skill

To choose which agents get the skill, open a terminal in your project directory and run the installer.

```sh
npx skills add redvulps/better-browser --skill better-browser
```

1. Select the agents you use on this machine, such as **Antigravity CLI (Agy)**, **Codex**, **Claude Code**, or **Cursor**. Agents in the **Universal** group are already included. If the installer detects only one agent, it may select it automatically.
2. Under **Installation scope**, choose **Project** for the current project or **Global** to use the skill across all your projects.
3. Confirm the installation. Check that `better-browser` appears in `npx skills ls` for a project installation or `npx skills ls -g` for a global installation.

Next, build the MCP server and register it with each client you use. [Build the project](#build-the-project) · [Agy](#agy) · [Codex CLI](#codex-cli) · [Claude Code](#claude-code) · [Cursor](#cursor)

## Build the project

With Node.js 22.13 or later installed, run the following commands to build the extension and the MCP server.

```sh
git clone https://github.com/redvulps/better-browser.git
cd better-browser
npm ci
npm run build
```

## Configure an MCP client

In your agent’s MCP settings, add a server named `better-browser` with the `stdio` transport. Set the command to the Node.js executable and pass the absolute path to `dist/mcp.js` as its only argument. Run these commands from the repository directory to get both paths.

```sh
node -p process.execPath
node -p "require('node:path').resolve('dist/mcp.js')"
```

Once the server loads, ask your agent to list available browsers. Its `list_browsers` tool can discover a browser before you pair it.

### Agy

Register the server from the directory where you built the project. Use the `/better-browser` skill to route browser requests to this server. Agy’s built-in `/browser` command opens its own browser tool.

```sh
agy mcp add better-browser "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

Open a new Agy session and enter `/skills` to check that `better-browser` is listed.

If you’re developing the skill, run `npm ci`, `npm run build`, and `./scripts/install-agy.sh` in your clone. The install script registers the MCP server and links the skill and the global browser routing rule to your working copy.

### Codex CLI

From the directory where you built the project, register the server.

```sh
codex mcp add better-browser -- "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

Start a new Codex session and look for `better-browser` in `/mcp`. With the default settings, clients running under the same OS account and using the same bridge can reuse the pairing.

### Claude Code

From the directory where you built the project, register the server for your user account.

```sh
claude mcp add --scope user --transport stdio better-browser -- "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

Open Claude Code and enter `/mcp` to check that `better-browser` is connected. [Claude Code MCP guide](https://code.claude.com/docs/en/mcp)

### Cursor

Add `better-browser` to `mcpServers` in `~/.cursor/mcp.json`. Replace the example paths with the absolute paths to Node.js and the built server on your machine. [Find your paths](#configure-an-mcp-client)

```json
{
  "mcpServers": {
    "better-browser": {
      "command": "/path/to/node",
      "args": ["/path/to/better-browser/dist/mcp.js"]
    }
  }
}
```

Open a chat in Agent mode and ask “List the browsers available through Better Browser.” [Cursor MCP guide](https://cursor.com/docs/mcp)

## Connect your browser

For an unpacked build, open `chrome://extensions` or `brave://extensions` in the profile you want to use. Enable **Developer mode**, click **Load unpacked**, and select `dist/extension`. If the browser runs on another computer, copy that directory there first.

The extension follows your browser’s interface language. It supports English and Brazilian Portuguese and uses English for other languages.

1. Open the extension. You can give the browser a name and click **Save**. The popup displays the same browser ID you’ll see in the chat.
2. Ask your agent to “List the browsers available through Better Browser.” In Agy, you can also enter `/better-browser`. At the default address, the MCP server starts a local bridge as needed. It may take a few seconds for the browser to appear on first use.
3. Choose a browser. For first-time pairing, open **Access token** in the extension, click **Show token**, and give the token to your client. The MCP server verifies it with the selected browser before saving it in a local file with mode `0600`. The pairing persists across sessions. A failed attempt preserves the previous credential. A token entered in chat may remain in the client’s conversation history.
4. Ask the agent to open a site. It uses the signed-in browser profile and opens the conversation’s tabs in a group labeled **BetterBrowser** in every client. Click **Pause** to suspend control or **Resume** to continue.

To update an unpacked installation, rebuild or copy the new files into the same `dist/extension` directory, then click **Reload** on the extension card. This keeps your existing token. When upgrading to version 0.3, approve the tab group and HTTP/HTTPS site permissions if prompted. Restart any older bridge you started manually, and open a new agent session to load the updated MCP tools.

On Linux, you can also enter the token in a terminal to keep it out of chat history.

```sh
systemd-ask-password "Better Browser token" | npm run --silent pair
```

## Run the browser and bridge on different computers

The extension opens an outbound WebSocket connection to the bridge and checks the TLS certificate for the configured address. Give the bridge a DNS name with a trusted certificate. For example, to use `agent.example.net`, start the bridge on its host and register its address with Agy on the agent’s machine.

```sh
BETTER_BROWSER_HOST=0.0.0.0 BETTER_BROWSER_PORT=8717 \
BETTER_BROWSER_CERT=/path/to/fullchain.pem BETTER_BROWSER_KEY=/path/to/privkey.pem \
npm run bridge
```

```sh
agy mcp add --env BETTER_BROWSER_URL=https://agent.example.net:8717 better-browser \
  "$(node -p process.execPath)" "$PWD/dist/mcp.js"
```

Set the bridge address in the extension popup to `wss://agent.example.net:8717/browser`. The Node.js process running the MCP server must also trust the certificate. For a private certificate authority, include `--env NODE_EXTRA_CA_CERTS=/path/to/ca.pem` in the `agy mcp add` command. Alternatively, keep the bridge on loopback and forward `/browser` through an HTTPS reverse proxy with WebSocket support. An MCP server on the bridge host can then keep its default address.

## Browser control and history

The extension keeps its token in local storage. The MCP server authenticates requests to the bridge with that browser’s token. The browser and the bridge use a mutual HMAC challenge to verify possession of the token before commands run. Browser discovery exposes each connected browser’s name and ID, including while control is paused. You can keep the browser’s remote debugging port closed.

**Pause** blocks commands from every conversation until you click **Resume**. **Rotate token** revokes the credential and access to current groups. The extension keeps the last 200 actions, including the time, origin, and outcome.

While the bridge is connected and at least one tab is under agent control, accessible HTTP and HTTPS pages display **BetterBrowser is controlling this browser** in English or **BetterBrowser está controlando este navegador** in Brazilian Portuguese. The notice follows you across tabs and page loads, including personal tabs. On protected pages, pin the extension to see the **BB** badge and hover over it to read the notice. The notice stays visible while a controlled tab remains open, even after a task ends. Pausing, disconnecting the bridge, or removing the last controlled tab clears it.

## Session tabs

The first `open` or `navigate` returns a `sessionId` that the skill reuses throughout the conversation. Use `open` to add a tab, `tabs` to list the group’s tabs, `select` to switch tabs, and `close` to close one. Use `navigate` to change the site in the selected tab, including across domains. Links that open new tabs can add those tabs to the session. The group stays open for you to inspect after the conversation ends.

The agent can read text and HTML controls in the main document, click a control by reference, and fill out forms. The extension checks the tab ID and group before each command. Moving a tab out of the group releases it from agent control. Personal tabs you drag into the group stay outside the agent’s session. The extension remembers which tabs belong to a session when its service worker goes idle or the bridge reconnects. Restarting the browser or reloading the extension can cause the next task to start a new group.

In controlled tabs, a virtual pointer moves to each target before the agent clicks or fills a field. The tip marks the interaction point. It stays at its last position across reloads and navigation in the same tab. If you prefer reduced motion, the pointer jumps directly to the target.

The shared protocol lives in `src/shared`, the MCP server in `src/agent`, the authenticated bridge session in `src/bridge`, and the browser interaction code in `src/extension`.

## Screenshots and video

Ask your agent to “take a screenshot of this tab”, “capture the full page”, or “record this workflow and send me the video”. The agent uses the same `browser` tool and `sessionId` as the rest of the conversation.

| Command | Result |
| --- | --- |
| `{"action":"screenshot"}` | Returns the visible area as a PNG image and its file path. |
| `{"action":"screenshot","fullPage":true}` | Captures the entire rendered document, including content below the viewport, at the current scroll position without scrolling the tab. Pages above 32 megapixels or 16,384 pixels on either side exceed the full-page limit. |
| `{"action":"record_start"}` | Starts a silent WebM of the selected session tab. The video follows the agent when it selects another managed tab. |
| `{"action":"record_stop"}` | Finishes the video and returns its file path. |

Screenshots hide the virtual pointer and click halo. The video includes them. The extension records one session at a time, marking its tab with a **REC** badge. Pause ends the recording. After resuming, ask the agent to collect it with `record_stop`. Recording also ends at five minutes or about 16 MiB. Disconnecting the bridge or rotating the token discards uncollected media.

Files are saved under `~/Downloads/BetterBrowser` on the machine running the MCP server. Set `BETTER_BROWSER_ARTIFACT_DIR` in the MCP server environment to choose another directory.

Version 0.5 adds the Chrome debugger permission to capture a specific session tab and the offscreen permission to encode video. When updating an unpacked installation, rebuild, reload the extension, restart the bridge, and start a new agent session. Once the extension permissions are granted, the agent can take screenshots and start and stop recordings directly. [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)

## Tests

The integration tests use the official MCP client, a local bridge, and temporary Chromium profiles with the extension installed. On Linux, install Xvfb and run the following commands from the repository directory.

```sh
npx playwright-core install chromium
xvfb-run -a npm test
```
