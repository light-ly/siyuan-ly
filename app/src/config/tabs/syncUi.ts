import {showMessage} from "../../dialog/message";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {ContractFormData} from "../../util/contractFormData";
import type {APICallbackResponse, APIPOSTRoutes} from "../../types/api";
import {confirmDialog} from "../../dialog/confirmDialog";
import {saveExportFile} from "../../protyle/util/compatibility";
import {getHostCapabilities} from "../../util/hostCapabilities";

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

/** 同步提供商选项：仅第三方（S3 / WebDAV / 本地文件系统），本地仅 std/docker 环境可用 */
export const getSyncProviderOptions = (): {value: Config.ISync["provider"]; label: string}[] => [
    {value: 2, label: "S3"},
    {value: 3, label: "WebDAV"},
    ...(["std", "docker"].includes(window.siyuan.config.system.container) ? [{value: 4, label: window.siyuan.languages.localFileSystem}] : []),
];

type SyncProviderConfigKey = Extract<keyof Config.ISync, "s3" | "webdav" | "local">;

type SyncProviderFieldDef =
    | {type: "input"; label: string; id: string; attrs?: string}
    | {type: "password"; label: string; id: string}
    | {type: "select"; label: string; id: string; options: {value: string; label: string}[]};

type SyncProviderDef = {
    configKey: SyncProviderConfigKey;
    api: string;
    getConfig: () => Config.ISync[SyncProviderConfigKey];
    genIntro: () => string;
    /** 第三方提供商配置是否可用；不依赖账号或订阅，始终可用 */
    isProviderConfigAllowed: () => boolean;
    fields: SyncProviderFieldDef[];
};

/** 同步提供商配置定义；仅第三方（S3 / WebDAV / 本地文件系统），不含官方云 */
const SYNC_PROVIDER_DEFS: Partial<Record<Config.ISync["provider"], SyncProviderDef>> = {
    2: {
        isProviderConfigAllowed: () => true,
        configKey: "s3",
        api: "/api/sync/setSyncProviderS3",
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
        api: "/api/sync/setSyncProviderWebDAV",
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
        api: "/api/sync/setSyncProviderLocal",
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

const buildProviderConfigKeywords = (): string[] => {
    return [
        // 第三方提供商说明与提示
        window.siyuan.languages.mobileNotSupport,
        window.siyuan.languages.syncThirdPartyProviderS3Intro,
        window.siyuan.languages.syncThirdPartyProviderWebDAVIntro,
        window.siyuan.languages.syncThirdPartyProviderLocalIntro,
        window.siyuan.languages.syncThirdPartyProviderTip,
        // 操作按钮
        window.siyuan.languages.cloudStoragePurge,
        window.siyuan.languages.import,
        window.siyuan.languages.export,
        // 表单标签与选项（硬编码英文）
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
};

const renderProviderConfig = (root: Element) => {
    const providerConfigElement = root.querySelector("#syncProviderConfig");
    if (!providerConfigElement) {
        return;
    }

    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    let html = "";
    if (def && def.isProviderConfigAllowed()) {
        html = `${def.genIntro()}${def.fields.map(genProviderField).join("")}${genProviderActionButtons(def.configKey)}`;
    }

    providerConfigElement.innerHTML = html;
    bindProviderConfigEvent(providerConfigElement, root);
};

const genProviderField = (field: SyncProviderFieldDef): string => {
    switch (field.type) {
        case "input":
            return genProviderFlexInput(field.label, field.id, field.attrs);
        case "password":
            return genProviderFlexPassword(field.label, field.id);
        case "select":
            return genProviderFlexSelect(field.label, field.id, field.options.map((option) => `
    <option value="${option.value}">${option.label}</option>`).join(""));
    }
};

const genProviderFlexInput = (label: string, id: string, attrs = "") => `<div class="b3-label b3-label--inner fn__flex">
    <div class="fn__flex-center fn__size200">${label}</div>
    <div class="fn__space"></div>
    <input spellcheck="false" id="${id}" class="b3-text-field fn__block"${attrs ? ` ${attrs}` : ""}>
</div>`;

const genProviderFlexPassword = (label: string, id: string) => `<div class="b3-label b3-label--inner fn__flex">
    <div class="fn__flex-center fn__size200">${label}</div>
    <div class="fn__space"></div>
    <div class="b3-form__icona fn__block">
        <input spellcheck="false" id="${id}" type="password" class="b3-text-field b3-form__icona-input">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div>
</div>`;

const genProviderFlexSelect = (label: string, id: string, optionsHtml: string) => `<div class="b3-label b3-label--inner fn__flex">
    <div class="fn__flex-center fn__size200">${label}</div>
    <div class="fn__space"></div>
    <select class="b3-select fn__block" id="${id}">
        ${optionsHtml}
    </select>
</div>`;

const genProviderActionButtons = (dataType: SyncProviderConfigKey) => {
    const importExportHtml = getHostCapabilities().importExport && (dataType === "s3" || dataType === "webdav") ? `
    <button class="b3-button b3-button--outline fn__size200" style="position: relative">
        <input id="importSyncConfig" class="b3-form__upload" type="file" data-type="${dataType}">
        <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.import}
    </button>
    <button class="b3-button b3-button--outline fn__size200" id="exportSyncConfig" data-type="${dataType}">
        <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}
    </button>` : "";
    return `<div class="b3-label b3-label--inner fn__flex fn__flex-wrap" style="gap: 8px; justify-content: flex-end">
    <button class="b3-button b3-button--outline fn__size200" id="purgeCloudData">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.cloudStoragePurge}
    </button>${importExportHtml}
</div>`;
};

const syncProviderConfigBoundElements = new WeakSet<Element>();
const syncProviderConfigSaves = new WeakMap<Element, Promise<void>>();

const bindProviderConfigEvent = (configElement: Element, root: Element) => {
    const togglePasswordIcon = configElement.querySelector('[data-action="togglePassword"]');
    togglePasswordIcon?.addEventListener("click", () => {
        const useElement = togglePasswordIcon.firstElementChild;
        const isEye = useElement.getAttribute("xlink:href") === "#iconEye";
        useElement.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
        (togglePasswordIcon.previousElementSibling as HTMLInputElement).setAttribute("type", isEye ? "text" : "password");
    });

    const importElement = configElement.querySelector("#importSyncConfig") as HTMLInputElement;
    importElement?.addEventListener("change", () => {
        if (!getHostCapabilities().importExport) {
            return;
        }
        const formData = new ContractFormData({file: importElement.files[0]});
        const isS3 = importElement.getAttribute("data-type") === "s3";
        fetchPost(isS3 ? "/api/sync/importSyncProviderS3" : "/api/sync/importSyncProviderWebDAV", formData, (response: APICallbackResponse<APIPOSTRoutes["/api/sync/importSyncProviderS3" | "/api/sync/importSyncProviderWebDAV"]["response"]>) => {
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

    configElement.querySelector("#purgeCloudData")?.addEventListener("click", () => {
        confirmDialog("♻️ " + window.siyuan.languages.cloudStoragePurge, `<div class="b3-typography">${window.siyuan.languages.cloudStoragePurgeConfirm}</div>`, () => {
            fetchPost("/api/repo/purgeCloudRepo");
        });
    });

    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    if (!def || !def.isProviderConfigAllowed()) {
        return;
    }
    fillSyncProviderConfigValues(configElement);
    if (syncProviderConfigBoundElements.has(configElement)) {
        return;
    }
    syncProviderConfigBoundElements.add(configElement);
    configElement.addEventListener("change", (event: Event) => {
        const target = event.target as HTMLElement;
        if (!target.matches(".b3-text-field, .b3-select")) {
            return;
        }
        saveSyncProviderConfigValues(configElement);
    });
};

const saveSyncProviderConfigValues = (configElement: Element) => {
    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    if (!def) {
        return;
    }
    const data = readProviderConfigFields(configElement, def.getConfig());
    const configKey = def.configKey;
    if (configKey === "s3") {
        for (const key of ["endpoint", "accessKey", "secretKey", "bucket", "region"]) {
            const input = configElement.querySelector<HTMLInputElement>(`#${key}`);
            if (!input.value.trim()) {
                return;
            }
        }
    }
    // 记录提交时的控件和值，仅回填未被继续编辑的控件，失败时保留输入。
    const fields = def.fields.map((field) => {
        const element = configElement.querySelector<HTMLInputElement | HTMLSelectElement>(`#${field.id}`);
        return {key: field.id, element, value: element.value};
    });
    // 同一表单的保存按编辑顺序执行，防止较早的响应覆盖后续配置。
    const saving = (syncProviderConfigSaves.get(configElement) || Promise.resolve())
        .then(() => fetchSyncPost(def.api, {[configKey]: data}))
        .then((response) => {
            if (response.code === 0 && response.data?.[configKey]) {
                window.siyuan.config.sync[configKey] = response.data[configKey];
                fields.forEach(({key, element, value}) => {
                    if (element.value === value) {
                        element.value = String(response.data[configKey][key]);
                    }
                });
            }
        })
        .catch(() => {});
    syncProviderConfigSaves.set(configElement, saving);
};

const fillSyncProviderConfigValues = (configElement: Element) => {
    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    if (!def) {
        return;
    }
    const data = def.getConfig();
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
