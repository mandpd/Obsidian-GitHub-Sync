import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from 'obsidian';
import { simpleGit, SimpleGit, CleanOptions, SimpleGitOptions } from 'simple-git';
import { setIntervalAsync, clearIntervalAsync } from 'set-interval-async';
import { Buffer } from 'buffer';

let simpleGitOptions: Partial<SimpleGitOptions>;
let git: SimpleGit;


interface GHSyncSettings {
	remoteURL: string;
	gitLocation: string;
	syncinterval: number;
	isSyncOnLoad: boolean;
	checkStatusOnLoad: boolean;
	githubToken: string;
	noteTargets: Record<string, NoteSyncTarget>;
}

interface NoteSyncTarget {
	repoUrl: string;
	owner: string;
	repo: string;
	branch: string;
	filePath: string;
}

const DEFAULT_SETTINGS: GHSyncSettings = {
	remoteURL: '',
	gitLocation: '',
	syncinterval: 0,
	isSyncOnLoad: false,
	checkStatusOnLoad: true,
	githubToken: '',
	noteTargets: {},
}


export default class GHSyncPlugin extends Plugin {

	settings: GHSyncSettings;

	async SyncNotes()
	{
		new Notice("Syncing to GitHub remote")

		const remote = this.settings.remoteURL.trim();

		simpleGitOptions = {
			//@ts-ignore
		    baseDir: this.app.vault.adapter.getBasePath(),
		    binary: this.settings.gitLocation + "git",
		    maxConcurrentProcesses: 6,
		    trimmed: false,
		};
		git = simpleGit(simpleGitOptions);

		let os = require("os");
		let hostname = os.hostname();

		let statusResult = await git.status().catch((e) => {
			new Notice("Vault is not a Git repo or git binary cannot be found.", 10000);
			return; })

		//@ts-ignore
		let clean = statusResult.isClean();

    	let date = new Date();
    	let msg = hostname + " " + date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + ":" + date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();

		// git add .
		// git commit -m hostname-date-time
		if (!clean) {
			try {
				await git
		    		.add("./*")
		    		.commit(msg);
		    } catch (e) {
		    	new Notice(e);
		    	return;
		    }
		} else {
			new Notice("Working branch clean");
		}

		// configure remote
		try {
			await git.removeRemote('origin').catch((e) => { new Notice(e); });
			await git.addRemote('origin', remote).catch((e) => { new Notice(e); });
		}
		catch (e) {
			new Notice(e);
			return;
		}
		// check if remote url valid by fetching
		try {
			await git.fetch();
		} catch (e) {
			new Notice(e + "\nGitHub Sync: Invalid remote URL.", 10000);
			return;
		}

		new Notice("GitHub Sync: Successfully set remote origin url");


		// git pull origin main
	    try {
	    	//@ts-ignore
	    	await git.pull('origin', 'main', { '--no-rebase': null }, (err, update) => {
	      		if (update) {
					new Notice("GitHub Sync: Pulled " + update.summary.changes + " changes");
	      		}
	   		})
	    } catch (e) {
	    	let conflictStatus = await git.status().catch((e) => { new Notice(e, 10000); return; });
    		let conflictMsg = "Merge conflicts in:";
	    	//@ts-ignore
			for (let c of conflictStatus.conflicted)
			{
				conflictMsg += "\n\t"+c;
			}
			conflictMsg += "\nResolve them or click sync button again to push with unresolved conflicts."
			new Notice(conflictMsg)
			//@ts-ignore	
			for (let c of conflictStatus.conflicted)
			{
				this.app.workspace.openLinkText("", c, true);
			}
	    	return;
	    }

		// resolve merge conflicts
		// git push origin main
	    if (!clean) {
		    try {
		    	await git.push('origin', 'main', ['-u']);
		    	new Notice("GitHub Sync: Pushed on " + msg);
		    } catch (e) {
		    	new Notice(e, 10000);
			}
	    }
	}

	async CheckStatusOnStart()
	{
		// check status
		try {
			simpleGitOptions = {
				//@ts-ignore
			    baseDir: this.app.vault.adapter.getBasePath(),
			    binary: this.settings.gitLocation + "git",
			    maxConcurrentProcesses: 6,
			    trimmed: false,
			};
			git = simpleGit(simpleGitOptions);

			//check for remote changes
			// git branch --set-upstream-to=origin/main main
			await git.branch({'--set-upstream-to': 'origin/main'});
			let statusUponOpening = await git.fetch().status();
			if (statusUponOpening.behind > 0)
			{
				// Automatically sync if needed
				if (this.settings.isSyncOnLoad == true)
				{
					this.SyncNotes();
				}
				else
				{
					new Notice("GitHub Sync: " + statusUponOpening.behind + " commits behind remote.\nClick the GitHub ribbon icon to sync.")
				}
			}
			else
			{
				new Notice("GitHub Sync: up to date with remote.")
			}
		} catch (e) {
			// don't care
			// based
		}
	}

	async onload() {
		await this.loadSettings();

		const ribbonIconEl = this.addRibbonIcon('github', 'Sync with Remote', (evt: MouseEvent) => {
			this.SyncNotes();
		});
		ribbonIconEl.addClass('gh-sync-ribbon');

		this.addCommand({
			id: 'github-sync-command',
			name: 'Sync with Remote',
			callback: () => {
				this.SyncNotes();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GHSyncSettingTab(this.app, this));

		if (!isNaN(this.settings.syncinterval))
		{
			let interval: number = this.settings.syncinterval;
			if (interval >= 1)
			{
				try {
					setIntervalAsync(async () => {
						await this.SyncNotes();
					}, interval * 60 * 1000);
					//this.registerInterval(setInterval(this.SyncNotes, interval * 6 * 1000));
					new Notice("Auto sync enabled");
				} catch (e) {
					
				}
			}
		}

		if (this.settings.checkStatusOnLoad)
		{
			this.CheckStatusOnStart();
		}

		this.registerFileMenu();
		this.registerNoteEventHandlers();
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerFileMenu() {
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') {
				return;
			}

			menu.addItem((item) => {
				item.setTitle('Set GitHub sync target')
					.setIcon('link')
					.onClick(() => {
						new NoteTargetModal(this.app, this, file).open();
					});
			});

			menu.addItem((item) => {
				item.setTitle('Sync page to GitHub')
					.setIcon('upload')
					.setDisabled(!this.settings.noteTargets[file.path])
					.onClick(() => {
						this.syncNoteWithGitHub(file);
					});
			});
		}));
	}

	private registerNoteEventHandlers() {
		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			if (!(file instanceof TFile)) {
				return;
			}
			const oldTarget = this.settings.noteTargets[oldPath];
			if (oldTarget) {
				delete this.settings.noteTargets[oldPath];
				this.settings.noteTargets[file.path] = oldTarget;
				await this.saveSettings();
			}
		}));

		this.registerEvent(this.app.vault.on('delete', async (file) => {
			if (!(file instanceof TFile)) {
				return;
			}
			if (this.settings.noteTargets[file.path]) {
				delete this.settings.noteTargets[file.path];
				await this.saveSettings();
			}
		}));
	}

	async syncNoteWithGitHub(file: TFile) {
		const target = this.settings.noteTargets[file.path];
		if (!target) {
			new Notice('No GitHub sync target set for this note.');
			return;
		}

		if (!this.settings.githubToken || this.settings.githubToken.trim().length === 0) {
			new Notice('Set a GitHub personal access token in the plugin settings before syncing notes.');
			return;
		}

		const content = await this.app.vault.read(file);
		const encodedContent = Buffer.from(content, 'utf8').toString('base64');
		const headers = {
			'Authorization': `token ${this.settings.githubToken.trim()}`,
			'Accept': 'application/vnd.github+json',
			'Content-Type': 'application/json'
		};

		const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodeURIComponentPath(target.filePath)}`;
		let existingSha: string | undefined;

		try {
			const existing = await requestUrl({
				url: `${apiUrl}?ref=${encodeURIComponent(target.branch)}`,
				method: 'GET',
				headers
			});
			// @ts-ignore
			existingSha = existing.json.sha;
		} catch (e: any) {
			if (!e || e.status !== 404) {
				new Notice('Unable to fetch current GitHub file contents.', 8000);
				console.error('Failed to load GitHub file before sync', e);
				return;
			}
			existingSha = undefined;
		}

		const body = {
			message: `Update ${file.name} from Obsidian on ${new Date().toISOString()}`,
			content: encodedContent,
			branch: target.branch,
			sha: existingSha,
		};

		try {
			await requestUrl({
				url: apiUrl,
				method: 'PUT',
				body: JSON.stringify(body),
				headers
			});
			new Notice(`Synced "${file.basename}" to GitHub`);
		} catch (e) {
			new Notice('Failed to sync note to GitHub. See console for details.', 8000);
			console.error('GitHub sync failed', e);
		}
	}

	async setNoteTarget(file: TFile, target: NoteSyncTarget | null) {
		if (!this.settings.noteTargets) {
			this.settings.noteTargets = {};
		}
		if (target) {
			this.settings.noteTargets[file.path] = target;
		} else {
			delete this.settings.noteTargets[file.path];
		}
		await this.saveSettings();
	}
}

class GHSyncSettingTab extends PluginSettingTab {
	plugin: GHSyncPlugin;

	constructor(app: App, plugin: GHSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const howto = containerEl.createEl("div", { cls: "howto" });
		howto.createEl("div", { text: "How to use this plugin", cls: "howto_title" });
		howto.createEl("small", { text: "Grab your GitHub repository's HTTPS or SSH url and paste it into the settings here. If you're not authenticated, the first sync with this plugin should prompt you to authenticate. If you've already setup SSH on your device with GitHub, you won't need to authenticate - just paste your repo's SSH url into the settings here.", cls: "howto_text" });
		howto.createEl("br");
        const linkEl = howto.createEl('p');
        linkEl.createEl('span', { text: 'See the ' });
        linkEl.createEl('a', { href: 'https://github.com/kevinmkchin/Obsidian-GitHub-Sync/blob/main/README.md', text: 'README' });
        linkEl.createEl('span', { text: ' for more information and troubleshooting.' });

		new Setting(containerEl)
			.setName('Remote URL')
			.setDesc('')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.remoteURL)
				.onChange(async (value) => {
					this.plugin.settings.remoteURL = value;
					await this.plugin.saveSettings();
				})
        	.inputEl.addClass('my-plugin-setting-text'));

		new Setting(containerEl)
			.setName('git binary location')
			.setDesc('This is optional! Set this only if git is not findable via your system PATH, then provide its location here. See README for more info.')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.gitLocation)
				.onChange(async (value) => {
					this.plugin.settings.gitLocation = value;
					await this.plugin.saveSettings();
				})
        	.inputEl.addClass('my-plugin-setting-text2'));

		new Setting(containerEl)
			.setName('GitHub personal access token')
			.setDesc('Required for per-page syncing via the GitHub API. Token needs repo scope for private repositories.')
			.addText(text => text
				.setPlaceholder('ghp_xxx')
				.setValue(this.plugin.settings.githubToken)
				.onChange(async (value) => {
					this.plugin.settings.githubToken = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Check status on startup')
			.setDesc('Check to see if you are behind remote when you start Obsidian.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.checkStatusOnLoad)
				.onChange(async (value) => {
					this.plugin.settings.checkStatusOnLoad = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync on startup')
			.setDesc('Automatically sync with remote when you start Obsidian if there are unsynced changes.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.isSyncOnLoad)
				.onChange(async (value) => {
					this.plugin.settings.isSyncOnLoad = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync at interval')
			.setDesc('Set minute interval after which your vault is synced automatically. Auto sync is disabled if this field is left empty or not a positive integer. Restart Obsidan to take effect.')
			.addText(text => text
				.setValue(String(this.plugin.settings.syncinterval))
				.onChange(async (value) => {
					this.plugin.settings.syncinterval = Number(value);
					await this.plugin.saveSettings();
				}));
	}
}

class NoteTargetModal extends Modal {
	private plugin: GHSyncPlugin;
	private file: TFile;
	private errorEl: HTMLDivElement;

	constructor(app: App, plugin: GHSyncPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: `GitHub sync target for "${this.file.basename}"` });
		contentEl.createEl('p', { text: 'Paste a GitHub file URL (e.g. https://github.com/user/repo/blob/main/docs/page.md).' });

		const existing = this.plugin.settings.noteTargets[this.file.path];
		const input = contentEl.createEl('input', { type: 'text' });
		input.value = existing?.repoUrl ?? '';
		input.style.width = '100%';

		this.errorEl = contentEl.createEl('div', { cls: 'github-sync-error' });

		const buttonContainer = contentEl.createEl('div', { cls: 'github-sync-actions' });

		const saveButton = buttonContainer.createEl('button', { text: 'Save target' });
		saveButton.onclick = async () => {
			await this.handleSave(input.value);
		};

		const clearButton = buttonContainer.createEl('button', { text: 'Clear target' });
		clearButton.onclick = async () => {
			await this.plugin.setNoteTarget(this.file, null);
			this.close();
			new Notice('Cleared GitHub sync target for note.');
		};
	}

	private async handleSave(value: string) {
		if (!value || value.trim().length === 0) {
			this.showError('Enter a GitHub file URL.');
			return;
		}

		const parsed = parseGitHubFileUrl(value.trim());
		if (!parsed) {
			this.showError('Invalid GitHub file URL.');
			return;
		}

		await this.plugin.setNoteTarget(this.file, { repoUrl: value.trim(), ...parsed });
		new Notice('Saved GitHub sync target.');
		this.close();
	}

	private showError(message: string) {
		this.errorEl.setText(message);
		this.errorEl.style.color = 'var(--text-error)';
	}
}

function parseGitHubFileUrl(url: string): Omit<NoteSyncTarget, 'repoUrl'> | null {
	try {
		const parsedUrl = new URL(url);
		const host = parsedUrl.hostname.toLowerCase();
		const parts = parsedUrl.pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p));

		if (host === 'github.com') {
			if (parts.length < 5 || parts[2] !== 'blob') {
				return null;
			}
			const owner = parts[0];
			const repo = parts[1];
			const branch = parts[3];
			const filePath = parts.slice(4).join('/');
			return { owner, repo, branch, filePath };
		}

		if (host === 'raw.githubusercontent.com') {
			if (parts.length < 4) {
				return null;
			}
			const owner = parts[0];
			const repo = parts[1];
			const branch = parts[2];
			const filePath = parts.slice(3).join('/');
			return { owner, repo, branch, filePath };
		}

		return null;
	} catch (e) {
		return null;
	}
}

function encodeURIComponentPath(path: string) {
	return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}
