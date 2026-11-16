import {Tab} from "../Tab";
import {bindPanelSearch} from "./panelSearch";
import {Model} from "../Model";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import type {App} from "../../index";
import {Constants} from "../../constants";
import {checkFold} from "../../util/noRelyPCFunction";
import {escapeAttr, escapeHtml} from "../../util/escape";

interface IDocMemo {
    id: string;
    memo: string;
    type: string;
    subType: string;
    content: string;
}

const PREVIEW_LIMIT = 80;

export class Memo extends Model {
    private element: HTMLElement;
    private listElement: HTMLElement;
    private data: IDocMemo[] = [];
    private rootID = "";
    private updating = false;
    private updatePending = false;

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "memo",
            msgCallback: this.handleMsgCallback.bind(this)
        });
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__memo", "dockPanel");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.memo}</div>
    <input spellcheck="false" class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.search}"><svg><use xlink:href='#iconSearch'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1 b3-list b3-list--background"></div>`;
        this.listElement = this.element.lastElementChild as HTMLElement;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const showSearch = bindPanelSearch(inputElement,
            this.element.querySelector('[data-type="search"]') as HTMLElement, () => this.render());
        this.element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).tagName === "INPUT") {
                return;
            }
            setPanelFocus(this.element);
            const iconElement = hasClosestByClassName(event.target as HTMLElement, "block__icon");
            if (iconElement) {
                const type = iconElement.getAttribute("data-type");
                switch (type) {
                    case "min":
                        getDockByType("memo")?.toggleModel("memo", false, true);
                        break;
                    case "refresh":
                        this.update();
                        break;
                    case "search":
                        showSearch();
                        break;
                }
                return;
            }
            const editElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
            const itemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
            if (!itemElement) {
                return;
            }
            if (editElement) {
                this.startEdit(itemElement);
                return;
            }
            const id = itemElement.getAttribute("data-node-id");
            checkFold(id, (zoomIn, action: TProtyleAction[]) => {
                openFileById({
                    app,
                    id,
                    action: action || [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                    zoomIn
                });
            });
        });
        this.render();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data?.cmd === "savedoc" && this.rootID && data.data?.rootID === this.rootID) {
            this.update();
        }
    }

    public update(protyle?: IProtyle) {
        if (protyle !== undefined) {
            this.rootID = protyle?.block?.rootID || "";
        }
        if (!this.rootID) {
            this.data = [];
            this.render();
            return;
        }
        if (this.updating) {
            this.updatePending = true;
            return;
        }
        this.updating = true;
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        element?.classList.add("fn__rotate");
        const rootID = this.rootID;
        fetchPost("/api/memo/getDocMemos", {id: rootID}, (response) => {
            if (this.rootID !== rootID) {
                this.updating = false;
                this.updatePending = false;
                this.update();
                return;
            }
            if (this.updatePending) {
                this.updatePending = false;
                this.updating = false;
                this.update();
                return;
            }
            this.data = (Array.isArray(response.data) ? response.data : []).filter((item): item is IDocMemo => !!item);
            this.render();
            element?.classList.remove("fn__rotate");
            this.updating = false;
        });
    }

    private render() {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = inputElement.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const items = keywords.length === 0 ? this.data : this.data.filter(item => {
            const text = `${item.memo || ""} ${item.content || ""}`.toLowerCase();
            return keywords.every(keyword => text.includes(keyword));
        });
        if (items.length === 0) {
            this.listElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            return;
        }
        this.listElement.innerHTML = `<ul>${items.map(item => {
            const preview = (item.content || "").replace(/\s+/g, " ").trim();
            const previewText = preview.length > PREVIEW_LIMIT ? preview.slice(0, PREVIEW_LIMIT) + "..." : preview;
            return `<li class="b3-list-item b3-list-item--narrow" data-node-id="${escapeAttr(item.id)}">
    <span class="b3-list-item__text" title="${escapeAttr(item.memo)}">${escapeHtml(item.memo)}</span>
    <span class="b3-list-item__meta" title="${escapeAttr(preview)}">${escapeHtml(previewText)}</span>
    <span class="b3-list-item__action" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
</li>`;
        }).join("")}</ul>`;
    }

    private startEdit(itemElement: HTMLElement) {
        if (itemElement.querySelector("input")) {
            return;
        }
        const id = itemElement.getAttribute("data-node-id");
        const current = this.data.find(item => item.id === id);
        const textElement = itemElement.querySelector(".b3-list-item__text") as HTMLElement;
        const inputElement = document.createElement("input");
        inputElement.className = "b3-text-field fn__block";
        inputElement.value = current?.memo || textElement.textContent || "";
        textElement.replaceWith(inputElement);
        inputElement.focus();
        inputElement.select();
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            if (!save || inputElement.value === (current?.memo || "")) {
                this.render();
                return;
            }
            fetchPost("/api/attr/setBlockAttrs", {
                id,
                attrs: {memo: inputElement.value}
            }, () => this.update());
        };
        inputElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                finish(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
            }
        });
        inputElement.addEventListener("blur", () => finish(true));
    }
}
