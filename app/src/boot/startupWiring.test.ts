import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, it} from "node:test";

// 合并上游时曾整块保留免账号改写、丢失同一冲突块中上游新增的启动接线（initWindowWithLoading 等），
// 导致主窗口启动遮罩无法结束。这里用源码断言守住两个入口文件的关键接线，双向防回归：
// 上游接线不得再丢，已移除的官方账号逻辑也不得回流。

const readEntry = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const mainEntry = readEntry("src/index.ts");
const windowEntry = readEntry("src/window/index.ts");

describe("desktop startup wiring", () => {
    it("wraps the main window boot flow with initWindowWithLoading", () => {
        assert.match(mainEntry, /initWindowWithLoading\(\(\) => onGetConfig\(response\.data\.start, this\), setTabPosition\)/);
    });

    it("wraps the detached window boot flow with initWindowWithLoading", () => {
        assert.match(windowEntry, /initWindowWithLoading\(\(\) => init\(this\), setTabPosition\)/);
    });

    it("keeps the settings sync wiring in both entries", () => {
        for (const source of [mainEntry, windowEntry]) {
            assert.match(source, /callback: \(\) => \{\s*if \(window\.siyuan\.isReady\)/);
            assert.match(source, /case "settingChanged":\s*void refreshSettingConfig\(data\.data\.namespace, data\.data\.revision\)/);
        }
    });

    it("clears live photos when a notebook closes or is removed", () => {
        for (const source of [mainEntry, windowEntry]) {
            assert.match(source, /closeNotebookLivePhotos\(data\.data\.box\)/);
        }
    });

    it("checks for a settings reset after the main window becomes ready", () => {
        assert.match(mainEntry, /mainWs\.flushMainMessages\(\);\s*exitAfterSettingsReset\(\);/);
    });

    it("registers desktop back navigation in the browser build", () => {
        assert.match(mainEntry, /#if BROWSER\s*registerDesktopBackNavigation\(\);/);
    });

    it("passes the upstream fetchAppId arguments in both entries", () => {
        for (const source of [mainEntry, windowEntry]) {
            assert.match(source, /installPluginStorageFetchAppId\(window, Constants\.SIYUAN_APPID, document\.baseURI, location\.origin\)/);
        }
    });
});

describe("account-free guarantee", () => {
    it("does not reintroduce official account boot calls", () => {
        for (const source of [mainEntry, windowEntry]) {
            assert.equal(source.includes("getCloudUser"), false, "getCloudUser must stay removed");
            assert.equal(source.includes("onSetaccount"), false, "onSetaccount must stay removed");
        }
    });
});
