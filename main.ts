import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from 'obsidian';
import { setIntervalAsync } from 'set-interval-async';
import { Buffer } from 'buffer';


interface GHSyncSettings {
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
	syncinterval: 0,
	isSyncOnLoad: false,
	checkStatusOnLoad: true,
	githubToken: '',
	noteTargets: {},
}


export default class GHSyncPlugin extends Plugin {

	settings: GHSyncSettings;

	async SyncAllTargetedNotes()
	{
		const targetedFiles = Object.keys(this.settings.noteTargets);

		if (targetedFiles.length === 0) {
			new Notice("No files with GitHub sync targets configured.");
			return;
		}

		new Notice(`Syncing ${targetedFiles.length} targeted file(s) to GitHub`);

		let successCount = 0;
		let failureCount = 0;

		for (const filePath of targetedFiles) {
			try {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file && file instanceof TFile) {
					await this.syncNoteWithGitHub(file);
					successCount++;
				} else {
					failureCount++;
				}
			} catch (e) {
				failureCount++;
				console.error(`Failed to sync ${filePath}:`, e);
			}
		}

		new Notice(`GitHub Sync complete: ${successCount} succeeded, ${failureCount} failed`);
	}

	async CheckStatusOnStart()
	{
		// Automatically sync targeted files on startup if enabled
		if (this.settings.isSyncOnLoad) {
			await this.SyncAllTargetedNotes();
		}
	}

	async onload() {
		await this.loadSettings();

		const ribbonIconEl = this.addRibbonIcon('github', 'Sync to GitHub', (evt: MouseEvent) => {
			this.SyncAllTargetedNotes();
		});
		ribbonIconEl.addClass('gh-sync-ribbon');

		this.addCommand({
			id: 'github-sync-command',
			name: 'Sync to GitHub',
			callback: () => {
				this.SyncAllTargetedNotes();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GHSyncSettingTab(this.app, this));

		if (!isNaN(this.settings.syncinterval))
		{
			const interval: number = this.settings.syncinterval;
			if (interval >= 1)
			{
				setIntervalAsync(async () => {
					await this.SyncAllTargetedNotes();
				}, interval * 60 * 1000);
				new Notice("Auto sync enabled");
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

	private displaySyncTargetsTable(containerEl: HTMLElement): void {
		const targetEntries = Object.entries(this.plugin.settings.noteTargets);

		if (targetEntries.length === 0) {
			containerEl.createEl("p", { text: "No sync targets configured yet. Use the context menu on a note to set a GitHub sync target.", cls: "github-sync-empty" });
			return;
		}

		containerEl.createEl("h4", { text: "Configured Sync Targets", cls: "github-sync-table-header" });

		const table = containerEl.createEl("table", { cls: "github-sync-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "File" });
		headerRow.createEl("th", { text: "Repository" });
		headerRow.createEl("th", { text: "Target Path" });
		headerRow.createEl("th", { text: "Branch" });

		const tbody = table.createEl("tbody");

		for (const [filePath, target] of targetEntries) {
			const row = tbody.createEl("tr");
			row.createEl("td", { text: filePath });
			row.createEl("td", { text: `${target.owner}/${target.repo}` });
			row.createEl("td", { text: target.filePath });
			row.createEl("td", { text: target.branch });
		}
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const howto = containerEl.createEl("div", { cls: "howto" });
		howto.createEl("div", { text: "How to use this plugin", cls: "howto_title" });
		howto.createEl("small", { text: "Use the 'Set GitHub sync target' option in your note's context menu to configure which GitHub file each note syncs to. You'll need a GitHub personal access token configured below.", cls: "howto_text" });
		howto.createEl("br");
        const linkEl = howto.createEl('p');
        linkEl.createEl('span', { text: 'See the ' });
        linkEl.createEl('a', { href: 'https://github.com/kevinmkchin/Obsidian-GitHub-Sync/blob/main/README.md', text: 'README' });
        linkEl.createEl('span', { text: ' for more information and troubleshooting.' });

		new Setting(containerEl)
			.setName('GitHub personal access token')
			.setDesc('Required for syncing notes via the GitHub API. Token needs repo scope for private repositories.')
			.addText(text => text
				.setPlaceholder('ghp_xxx')
				.setValue(this.plugin.settings.githubToken)
				.onChange(async (value) => {
					this.plugin.settings.githubToken = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync on startup')
			.setDesc('Automatically sync all targeted files with GitHub when you start Obsidian.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.isSyncOnLoad)
				.onChange(async (value) => {
					this.plugin.settings.isSyncOnLoad = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto sync at interval')
			.setDesc('Set minute interval after which all targeted files are synced automatically. Auto sync is disabled if this field is left empty or not a positive integer. Restart Obsidian to take effect.')
			.addText(text => text
				.setValue(String(this.plugin.settings.syncinterval))
				.onChange(async (value) => {
					this.plugin.settings.syncinterval = Number(value);
					await this.plugin.saveSettings();
				}));

		// Add sync targets table at the end
		this.displaySyncTargetsTable(containerEl);
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
