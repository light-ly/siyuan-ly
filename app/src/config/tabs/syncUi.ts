import {config as configApi} from "../util/configApi";
import {showMessage} from "../../dialog/message";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {ContractFormData} from "../../util/contractFormData";
import type {APICallbackResponse, APIPOSTRoutes} from "../../types/api";
import {confirmDialog} from "../../dialog/confirmDialog";
import {saveExportFile} from "../../protyle/util/compatibility";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {Dialog} from "../../dialog";
import {escapeHtmlTextAndAttr} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {canPurgeRepo} from "../../history/repoPurge";
import {refreshSyncCloudDirBlock} from "../../sync/syncGuide";

/** 按当前配置刷新同步 Tab 可见性与动态面板（供 syncRuntime 调用） */
export const refreshSyncTabPanels = (root: Element) => {
    setSyncConfigItemVisible(root);
    setSyncModeRelatedConfigItemVisible(root);
    renderProviderConfig(root);
};

/** 仅刷新与同步模式相关的配置项可见性（供 syncRuntime 调用） */
export const refreshSyncModeRelatedItems = (root: Element) => {
    setSyncModeRelatedConfigItemVisible(root);
};

/** 根据云端同步和运行环境刷新局域网同步配置项可见性；局域网同步为本地能力，不依赖账号或订阅 */
export const refreshLANSyncConfigItemVisibility = (root: Element) => {
    const visible = window.siyuan.config.sync.provider !== 0 && window.siyuan.config.sync.enabled && window.siyuan.config.system.container !== "docker";
    root.querySelector(`#${CSS.escape("sync.lan.enabled")}`)?.closest(".config-item")?.classList.toggle("fn__none", !visible);
};

/** 搜索时区分局域网同步的前置条件和硬性使用限制 */
export const getLANSyncSearchAvailability = () => {
    if (window.siyuan.config.sync.provider === 0 || window.siyuan.config.system.container === "docker") {
        return {available: false};
    }
    if (!window.siyuan.config.sync.enabled) {
        return {available: false, reason: window.siyuan.languages._kernel[53]};
    }
    return {available: true};
};

const setSyncConfigItemVisible = (root: Element) => {
    // 仅第三方提供商可用；历史配置若仍为 provider 0（官方云），视为不可用并隐藏同步项
    const visible = window.siyuan.config.sync.provider !== 0;
    [
        "sync.enabled",
        "sync.generateConflictDoc",
        "sync.mode",
        "sync.assetDownloadMode",
        "sync.interval",
        "sync.perception",
        "sync.lan.enabled",
        "syncCloudDirBlock",
        "syncCloudBackupBlock",
    ]
    .forEach((id) => {
        root.querySelector(`#${CSS.escape(id)}`)?.closest(".config-item")?.classList.toggle("fn__none", !visible);
    });
    root.querySelector("#cloudRepoPurgeBlock")?.classList.toggle("fn__none", !canPurgeRepo("cloud", window.siyuan.config.sync.provider));
    refreshLANSyncConfigItemVisibility(root);
};

const setSyncModeRelatedConfigItemVisible = (root: Element) => {
    const syncModeElement = root.querySelector(`#${CSS.escape("sync.mode")}`) as HTMLSelectElement | null;
    if (!syncModeElement) {
        return;
    }
    const syncMode: Config.ISync["mode"] = Number(syncModeElement.value);
    const isAutoSync = syncMode === 1;
    root.querySelector(`#${CSS.escape("sync.interval")}`)?.closest(".config-item")?.classList.toggle("fn__none", !isAutoSync);
    // 同步感知仅官方云支持，第三方与历史 provider 0 配置均不展示
    root.querySelector(`#${CSS.escape("sync.perception")}`)?.closest(".config-item")?.classList.toggle("fn__none", !(isAutoSync && window.siyuan.config.sync.provider === 0 && window.siyuan.config.system.container !== "docker"));
};

/** 同步提供商配置区检索关键词（供 syncTab 注册 slot） */
export const getSyncProviderConfigKeywords = (): string[] => buildProviderConfigKeywords();

/** 配置行与说明区共用操作和字段关键词，搜索弹窗字段时保留配置入口 */
export const getSyncProviderConfigRowKeywords = (): string[] => [
    window.siyuan.languages.syncConfig,
    window.siyuan.languages.syncConfigTip,
    window.siyuan.languages.config,
    window.siyuan.languages.import,
    window.siyuan.languages.export,
    window.siyuan.languages.clearSyncConfig,
    "Endpoint",
    "Access Key",
    "Secret Key",
    "Bucket",
    "Region ID",
    "Timeout (s)",
    "Addressing",
    "Path-style",
    "Virtual-hosted-style",
    "TLS Verify",
    "Verify",
    "Skip",
    "Concurrent Reqs",
    "Username",
    "Password",
];

type SyncProviderConfigKey = Extract<keyof Config.ISync, "s3" | "webdav" | "local">;

type SyncProviderFieldDef =
    | {type: "input"; label: string; id: string; attrs?: string}
    | {type: "password"; label: string; id: string}
    | {type: "select"; label: string; id: string; options: {value: string; label: string}[]};

type SyncProviderDef = {
    configKey: SyncProviderConfigKey;
    getConfig: () => Config.ISync[SyncProviderConfigKey];
    genIntro: () => string;
    isProviderConfigAllowed: () => boolean;
    fields: SyncProviderFieldDef[];
};

/** 同步提供商选项：仅第三方（S3 / WebDAV / 本地文件系统），本地仅 std/docker 环境可用 */
export const getSyncProviderOptions = (): {value: Config.ISync["provider"]; label: string}[] => [
    {value: 2, label: "S3"},
    {value: 3, label: "WebDAV"},
    ...(["std", "docker"].includes(window.siyuan.config.system.container) ? [{value: 4, label: window.siyuan.languages.localFileSystem}] : []),
];

/** 同步提供商配置定义；仅第三方（S3 / WebDAV / 本地文件系统），不含官方云 */
const SYNC_PROVIDER_DEFS: Partial<Record<Config.ISync["provider"], SyncProviderDef>> = {
    2: {
        isProviderConfigAllowed: () => true,
        configKey: "s3",

        getConfig: () => window.siyuan.config.sync.s3,
        genIntro: () => `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderS3Intro}
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Access Key", id: "accessKey"},
            {type: "password", label: "Secret Key", id: "secretKey"},
            {type: "input", label: "Bucket", id: "bucket"},
            {type: "input", label: "Region ID", id: "region"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "select", label: "Addressing", id: "pathStyle", options: [
                {value: "true", label: "Path-style"},
                {value: "false", label: "Virtual-hosted-style"},
            ]},
            {type: "select", label: "TLS Verify", id: "skipTlsVerify", options: [
                {value: "false", label: "Verify"},
                {value: "true", label: "Skip"},
            ]},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="16"'},
        ],
    },
    3: {
        isProviderConfigAllowed: () => true,
        configKey: "webdav",

        getConfig: () => window.siyuan.config.sync.webdav,
        genIntro: () => `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderWebDAVIntro}
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Username", id: "username"},
            {type: "password", label: "Password", id: "password"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "select", label: "TLS Verify", id: "skipTlsVerify", options: [
                {value: "false", label: "Verify"},
                {value: "true", label: "Skip"},
            ]},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="16"'},
        ],
    },
    4: {
        isProviderConfigAllowed: () => true,
        configKey: "local",

        getConfig: () => window.siyuan.config.sync.local,
        genIntro: () => `<div class="b3-label b3-label--inner">
    <div class="ft__error">
        ${window.siyuan.languages.mobileNotSupport}
    </div>
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderLocalIntro}
</div>`,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="1024"'},
        ],
    },
};

const buildProviderConfigKeywords = (): string[] => [
    // 第三方提供商说明与提示
    window.siyuan.languages.mobileNotSupport,
    window.siyuan.languages.syncThirdPartyProviderS3Intro,
    window.siyuan.languages.syncThirdPartyProviderWebDAVIntro,
    window.siyuan.languages.syncThirdPartyProviderLocalIntro,
    window.siyuan.languages.syncThirdPartyProviderTip,
    ...getSyncProviderConfigRowKeywords(),
];

/** 第三方同步配置摘要：S3 显示「Bucket · Endpoint」，WebDAV 显示「Username · Endpoint」，未配置时给本地化占位 */
const getProviderConfigSummary = (def: SyncProviderDef): string => {
    const endpoint = def.getConfig().endpoint?.trim() || "";
    if (!endpoint) {
        return window.siyuan.languages.noProviderConfigured;
    }
    // S3 以 Endpoint + Bucket 定位仓库，WebDAV 以 Endpoint + Username；只显示 Endpoint 时换桶看不出变化
    const sync = window.siyuan.config.sync;
    const scope = def.configKey === "s3" ? sync.s3?.bucket?.trim() : def.configKey === "webdav" ? sync.webdav?.username?.trim() : "";
    // 作用域在前：值行末尾会被省略号截断，而作用域才是区分仓库的那一项；分隔符沿用思源既有的「 · 」
    return scope ? `${scope} · ${endpoint}` : endpoint;
};

/** 同步服务配置行内容：标题 / 说明 / 当前值 + 操作按钮列；整项显隐由调用方按同一条件控制 */
const genProviderConfigRowHtml = (def: SyncProviderDef): string => {
    const L = window.siyuan.languages;
    const disabled = window.siyuan.config.readonly ? " disabled" : "";
    const summary = getProviderConfigSummary(def);
    const canImportExport = getHostCapabilities().importExport && (def.configKey === "s3" || def.configKey === "webdav");
    // 导入 / 导出仅 S3 与 WebDAV 支持；多个操作按钮竖排，与同分组的数据仓库密钥一致
    const importExportHtml = canImportExport ? `<div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" style="position: relative"${disabled}>
        <input id="importSyncConfig" class="b3-form__upload" type="file" data-type="${def.configKey}">
        <svg><use xlink:href="#iconDownload"></use></svg>${L.import}
    </button>
    <div class="fn__hr"></div>
    <button class="b3-button b3-button--outline fn__block" id="exportSyncConfig" data-type="${def.configKey}"${disabled}>
        <svg><use xlink:href="#iconUpload"></use></svg>${L.export}
    </button>` : "";
    return `<div class="fn__flex">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${L.syncConfig}</div>
        <div class="b3-label__text">${L.syncConfigTip}</div>
        <div class="b3-label__text fn__ellipsis" title="${escapeHtmlTextAndAttr(summary)}">${escapeHtmlTextAndAttr(summary)}</div>
    </div>
    <span class="fn__space"></span>
    <div class="fn__size200 fn__flex-center">
        <button class="b3-button b3-button--outline fn__block" data-action="configureSync"${disabled}>
            <svg><use xlink:href="#iconSettings"></use></svg>${L.config}
        </button>${importExportHtml}
    </div>
</div>`;
};

const renderProviderConfig = (root: Element) => {
    const providerConfigElement = root.querySelector("#syncProviderConfig");
    if (!providerConfigElement) {
        return;
    }
    const rowElement = root.querySelector("#syncProviderConfigRow");

    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    let introHtml = "";
    let rowHtml = "";
    if (def && def.isProviderConfigAllowed()) {
        introHtml = def.genIntro();
        rowHtml = genProviderConfigRowHtml(def);
    }

    providerConfigElement.innerHTML = introHtml;
    if (rowElement) {
        rowElement.innerHTML = rowHtml;
        rowElement.classList.toggle("fn__none", !rowHtml);
        bindProviderConfigEvent(rowElement, root);
    }
};

const genProviderField = (field: SyncProviderFieldDef, warning = ""): string => {
    switch (field.type) {
        case "input":
            return genProviderFlexInput(field.label, field.id, field.attrs, warning);
        case "password":
            return genProviderFlexPassword(field.label, field.id);
        case "select":
            return genProviderFlexSelect(field.label, field.id, field.options.map((option) => `
    <option value="${option.value}">${option.label}</option>`).join(""));
    }
};

const genProviderFlexInput = (label: string, id: string, attrs = "", warning = "") => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><input spellcheck="false" id="${id}" class="b3-text-field fn__block" aria-describedby="sync-${id}-error${warning ? ` sync-${id}-warning` : ""}"${attrs ? ` ${attrs}` : ""}>
    <div id="sync-${id}-error" class="ft__error fn__none" role="status"><div class="fn__hr"></div><span></span></div>${warning ? `
    <div id="sync-${id}-warning" class="ft__error fn__none" role="status"><div class="fn__hr"></div><span>${warning}</span></div>` : ""}</div>
</div>`;

const genProviderFlexPassword = (label: string, id: string) => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><div class="b3-form__icona fn__block">
        <input spellcheck="false" id="${id}" type="password" class="b3-text-field b3-form__icona-input" aria-describedby="sync-${id}-error">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div><div id="sync-${id}-error" class="ft__error fn__none" role="status"><div class="fn__hr"></div><span></span></div></div>
</div>`;

const genProviderFlexSelect = (label: string, id: string, optionsHtml: string) => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><select class="b3-select fn__block" id="${id}">
        ${optionsHtml}
    </select></div>
</div>`;

const bindProviderConfigEvent = (configElement: Element, root: Element) => {
    const importElement = configElement.querySelector("#importSyncConfig") as HTMLInputElement;
    importElement?.addEventListener("change", () => {
        if (!getHostCapabilities().importExport) {
            return;
        }
        const formData = new ContractFormData({file: importElement.files[0]});
        const isS3 = importElement.getAttribute("data-type") === "s3";
        fetchPost(isS3 ? "/api/sync/importSyncProviderS3" : "/api/sync/importSyncProviderWebDAV", formData, (response: APICallbackResponse<APIPOSTRoutes["/api/sync/importSyncProviderS3" | "/api/sync/importSyncProviderWebDAV"]["response"]>) => {
            if (response.code !== 0 || !response.data) {
                return;
            }
            if ("s3" in response.data) {
                window.siyuan.config.sync.s3 = response.data.s3;
            } else {
                window.siyuan.config.sync.webdav = response.data.webdav;
            }
            renderProviderConfig(root);
            showMessage(window.siyuan.languages.imported);
        });
    });

    const exportButton = configElement.querySelector("#exportSyncConfig");
    exportButton?.addEventListener("click", () => {
        if (!getHostCapabilities().importExport) {
            return;
        }
        fetchPost(exportButton.getAttribute("data-type") === "s3" ? "/api/sync/exportSyncProviderS3" : "/api/sync/exportSyncProviderWebDAV", {}, (response) => {
            void saveExportFile(response.data.zip);
        });
    });

    configElement.querySelector('[data-action="configureSync"]')?.addEventListener("click", () => {
        openSyncProviderConfigDialog(root);
    });
};

let syncProviderDialog: Dialog | undefined;

const validateSyncProviderFields = (configElement: Element, def: SyncProviderDef, requiredFields: readonly string[]) => {
    let valid = true;
    def.fields.filter(field => field.type !== "select").forEach(field => {
        const key = field.id;
        const input = configElement.querySelector<HTMLInputElement>(`#${key}`);
        const missing = !input.value.trim() && (requiredFields.includes(key) || input.type === "number");
        const message = missing ? window.siyuan.languages._kernel[142] :
            input.type === "number" && !input.checkValidity() ? input.validationMessage : "";
        input.setAttribute("aria-invalid", String(!!message));
        const error = configElement.querySelector<HTMLElement>(`#sync-${key}-error`);
        // 提示文本节点前有间隔元素，只替换文案节点
        (error.lastElementChild as HTMLElement).textContent = message;
        error.classList.toggle("fn__none", !message);
        valid &&= !message;
    });
    return valid;
};

const openSyncProviderConfigDialog = (root: Element) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    if (syncProviderDialog) {
        syncProviderDialog.element.querySelector<HTMLElement>(".b3-dialog__container").focus();
        return;
    }
    const provider = window.siyuan.config.sync.provider;
    const def = SYNC_PROVIDER_DEFS[provider];
    if (!def || !def.isProviderConfigAllowed()) {
        return;
    }
    const L = window.siyuan.languages;
    const warning = def.configKey === "s3" ? L.s3EndpointBucketWarning : "";
    // 测试连接仅用于 S3：探测会写入并删除探针对象，WebDAV 与本地目录没有等价的列举语义
    const testButton = def.configKey === "s3" ? `<div class="fn__space"></div>
    <button class="b3-button b3-button--outline" data-action="test"><svg class="b3-button__icon"><use xlink:href="#iconPlugZap"></use></svg><span>${L.testConnection}</span></button>` : "";
    let closed = false;
    let rulesVersion = 0;
    let rulesTimer: ReturnType<typeof setTimeout>;
    const dialog = new Dialog({
        title: `${L.syncConfig} - ${def.configKey === "s3" ? "S3" : def.configKey === "webdav" ? "WebDAV" : L.localFileSystem}`,
        width: isMobile() ? "92vw" : "680px",
        containerClassName: "config-sync-dialog",
        content: `<div class="b3-dialog__content config-sync-form">${def.fields.map(field => genProviderField(field, field.id === "endpoint" ? warning : "")).join("")}
<div data-type="sync-config-error" class="ft__error fn__none" role="status"></div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--remove" data-action="clear">${L.clearSyncConfig}</button>${testButton}<div class="fn__flex-1"></div><div class="fn__space"></div>
    <button class="b3-button b3-button--cancel" data-action="cancel">${L.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save">${L.save}</button>
</div>`,
        destroyCallback: () => {
            closed = true;
            rulesVersion++;
            clearTimeout(rulesTimer);
            if (syncProviderDialog === dialog) {
                syncProviderDialog = undefined;
            }
        },
    });
    syncProviderDialog = dialog;
    const configElement = dialog.element;
    const template = {...def.getConfig()};
    fillSyncProviderConfigValues(configElement, template);
    const testElement = configElement.querySelector<HTMLButtonElement>('[data-action="test"]');
    const testLabel = testElement?.querySelector("span");
    const fields = def.fields.map(field => configElement.querySelector<HTMLInputElement | HTMLSelectElement>(`#${field.id}`));
    const initialValues = fields.map(field => field.value);
    const destroy = dialog.destroy.bind(dialog);
    let pending = false;
    let confirming = false;
    let validationShown = false;
    let requiredFields: string[] = [];
    let rulesFailed = false;
    const setPending = (value: boolean) => {
        pending = value;
        if (value) {
            rulesVersion++;
            clearTimeout(rulesTimer);
            rulesFailed = false;
        }
        configElement.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
            element.disabled = value || (window.siyuan.config.readonly && element.getAttribute("data-action") !== "cancel");
        });
        configElement.setAttribute("aria-busy", String(value));
    };
    const setStatus = (message: string, success = false) => {
        const error = configElement.querySelector<HTMLElement>('[data-type="sync-config-error"]');
        error.textContent = message;
        error.classList.toggle("fn__none", !message);
        error.classList.toggle("ft__success", !!message && success);
        error.classList.toggle("ft__error", !!message && !success);
    };
    const setError = (message: string) => setStatus(message);
    const loadRules = async () => {
        const version = ++rulesVersion;
        const response = await fetchSyncPost("/api/sync/getSyncProviderConfigRules", {
            provider,
            endpoint: configElement.querySelector<HTMLInputElement>("#endpoint").value,
            bucket: configElement.querySelector<HTMLInputElement>("#bucket")?.value || "",
        }).catch(error => {
            if (closed || version !== rulesVersion) return;
            throw error;
        });
        if (!response || closed || version !== rulesVersion) return;
        if (response.code !== 0) throw new Error(response.msg || L.syncConfigSaveFailed);
        requiredFields = response.data.requiredFields;
        configElement.querySelector("#sync-endpoint-warning")?.classList.toggle("fn__none", !response.data.endpointBucketWarning);
        if (validationShown) validateSyncProviderFields(configElement, def, requiredFields);
        return response.data;
    };
    const refreshRules = () => {
        void loadRules().then(rules => {
            if (rules && rulesFailed) {
                rulesFailed = false;
                setError("");
            }
        }).catch(() => {
            if (!closed && !pending) {
                rulesFailed = true;
                setError(L.loadingError);
            }
        });
    };
    dialog.destroy = () => {
        if (pending || confirming) {
            return;
        }
        if (fields.every((field, index) => field.value === initialValues[index])) {
            destroy();
        } else {
            confirming = true;
            confirmDialog(L.confirm, L.discardUnsavedChanges, () => destroy(), () => { confirming = false; });
        }
    };
    const refresh = () => {
        const currentRoot = root.isConnected ? root : document.querySelector("#syncProviderConfig")?.closest(".config__tab-container, .config");
        if (currentRoot) {
            refreshSyncTabPanels(currentRoot);
            if (window.siyuan.config.sync.provider === 2) {
                refreshSyncCloudDirBlock(currentRoot);
            }
            const enabled = currentRoot.querySelector<HTMLInputElement>('[id="sync.enabled"]');
            if (enabled) {
                enabled.checked = window.siyuan.config.sync.enabled;
            }
        }
    };
    const save = async () => {
        if (pending || confirming || window.siyuan.config.readonly) {
            return;
        }
        validationShown = true;
        if (!validateSyncProviderFields(configElement, def, requiredFields)) {
            setError(L.syncConfigNotSaved);
            configElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            return;
        }
        setPending(true);
        setError("");
        try {
            const rules = await loadRules();
            if (!rules || window.siyuan.config.readonly) {
                setError(L.syncConfigSaveFailed);
                return;
            }
            if (!validateSyncProviderFields(configElement, def, rules.requiredFields)) {
                setError(L.syncConfigNotSaved);
                return;
            }
            let saved = false;
            await configApi.set(`sync.${def.configKey}`, readProviderConfigFields(configElement, template), () => {
                saved = true;
                refresh();
                destroy();
            });
            if (!saved) setError(L.syncConfigSaveFailed);
        } catch (error) {
            setError(error?.message || L.syncConfigSaveFailed);
        } finally {
            setPending(false);
            if (!closed) configElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        }
    };
    configElement.querySelector('[data-action="save"]').addEventListener("click", () => { void save(); });
    configElement.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.destroy());
    // 测试连接只探测当前草稿，不保存配置；失败分为确定错误与网络未知，避免把无法判定的情况报成配置问题
    const testConnection = async () => {
        if (pending || confirming || window.siyuan.config.readonly || !testElement || !testLabel) {
            return;
        }
        validationShown = true;
        if (!validateSyncProviderFields(configElement, def, requiredFields)) {
            setError(L.syncConfigNotSaved);
            configElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            return;
        }
        setError("");
        setPending(true);
        testLabel.textContent = L.testConnectionTesting;
        try {
            // 必填清单来自内核，规则尚未返回时它是空的，空值会漏过本地校验并被内核报成配置错误，因此先取规则
            let rules: Awaited<ReturnType<typeof loadRules>>;
            try {
                rules = await loadRules();
            } catch {
                if (!closed) {
                    setError(L.loadingError);
                }
                return;
            }
            if (closed) {
                return;
            }
            if (!rules) {
                setError(L.loadingError);
                return;
            }
            if (!validateSyncProviderFields(configElement, def, rules.requiredFields)) {
                setError(L.syncConfigNotSaved);
                configElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
                return;
            }
            const response = await fetchSyncPost("/api/sync/testSyncProviderS3", {
                s3: readProviderConfigFields(configElement, template),
            });
            if (closed) {
                return;
            }
            if (response.code !== 0) {
                setError(response.msg || L.testConnectionFail);
            } else if ("ok" === response.data.kind) {
                setStatus(L.testConnectionSuccess, true);
            } else {
                setStatus(response.data.msg ? L.testConnectionFailMsg.replace("${msg}", response.data.msg) : L.testConnectionFail);
            }
        } catch {
            if (!closed) {
                setError(L.testConnectionFail);
            }
        } finally {
            testLabel.textContent = L.testConnection;
            setPending(false);
        }
    };
    testElement?.addEventListener("click", () => { void testConnection(); });
    configElement.querySelector('[data-action="clear"]').addEventListener("click", () => {
        if (pending || confirming || window.siyuan.config.readonly) {
            return;
        }
        confirming = true;
        confirmDialog(L.clearSyncConfig, L.clearSyncConfigConfirm, () => {
            confirming = false;
            if (window.siyuan.config.readonly) {
                return;
            }
            setPending(true);
            setError("");
            void fetchSyncPost("/api/sync/clearSyncProviderConfig", {provider}).then(response => {
                if (response.code !== 0) {
                    setError(response.msg || L.syncConfigSaveFailed);
                    return;
                }
                if (response.data.s3) {
                    window.siyuan.config.sync.s3 = response.data.s3;
                }
                if (response.data.webdav) {
                    window.siyuan.config.sync.webdav = response.data.webdav;
                }
                if (response.data.local) {
                    window.siyuan.config.sync.local = response.data.local;
                }
                window.siyuan.config.sync.enabled = response.data.enabled;
                refresh();
                destroy();
            }).catch(() => setError(L.syncConfigSaveFailed)).finally(() => setPending(false));
        }, () => { confirming = false; }, true, undefined, L.clearSyncConfig);
    });
    configElement.addEventListener("input", () => {
        rulesVersion++;
        clearTimeout(rulesTimer);
        configElement.querySelector("#sync-endpoint-warning")?.classList.toggle("fn__none", true);
        // 配置已改变，旧的测试结果不再对应当前草稿
        setStatus("");
        rulesTimer = setTimeout(refreshRules, 300);
        if (validationShown) {
            validateSyncProviderFields(configElement, def, requiredFields);
        }
    });
    configElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.repeat) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dialog.destroy();
        } else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
            event.preventDefault();
            event.stopPropagation();
            void save();
        }
    });
    configElement.querySelector('[data-action="togglePassword"]')?.addEventListener("click", () => {
        const input = configElement.querySelector<HTMLInputElement>('input[id="secretKey"], input[id="password"]');
        const icon = configElement.querySelector('[data-action="togglePassword"] use');
        input.type = input.type === "password" ? "text" : "password";
        icon.setAttribute("xlink:href", input.type === "password" ? "#iconEye" : "#iconEyeoff");
    });
    refreshRules();
    fields[0].focus();
};

const fillSyncProviderConfigValues = (configElement: Element, data: Config.ISync[SyncProviderConfigKey]) => {
    (Object.keys(data) as (keyof typeof data & string)[]).forEach((key) => {
        const el = configElement.querySelector(`#${key}`) as HTMLInputElement | HTMLSelectElement | null;
        if (el) {
            el.value = String(data[key]);
        }
    });
};

const readProviderConfigFields = <T extends object>(configElement: Element, template: T): T => {
    const result = {} as Record<string, unknown>;
    (Object.keys(template) as (keyof T & string)[]).forEach((key) => {
        const el = configElement.querySelector(`#${key}`) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) {
            return;
        }
        const sample = template[key];
        if (typeof sample === "boolean") {
            result[key] = el.value === "true";
        } else if (typeof sample === "number") {
            result[key] = parseInt(el.value, 10);
        } else {
            result[key] = el.value;
        }
    });
    return result as T;
};
