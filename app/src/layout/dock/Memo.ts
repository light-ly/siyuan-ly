import dayjs from "dayjs";
import {Tab} from "../Tab";
import {bindPanelSearch} from "./panelSearch";
import {Model} from "../Model";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {decodeInlineMemoContent, encodeInlineMemoContent} from "../../protyle/util/inlineMemo";
import {updateTransaction} from "../../protyle/wysiwyg/transaction";
import type {App} from "../../index";
import {Constants} from "../../constants";
import {checkFold} from "../../util/noRelyPCFunction";
import {escapeAttr, escapeHtml} from "../../util/escape";

interface IInlineMemoItem {
    blockID: string;
    index: number; // 块内第几个行级备注
    anchor: string; // 划线文本
    memo: string; // 备注内容
}

const PREVIEW_LIMIT = 80;

export class Memo extends Model {
    private element: HTMLElement;
    private listElement: HTMLElement;
    private data: IInlineMemoItem[] = [];
    private protyle: IProtyle;
    private rootID = "";

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
        this.update();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data?.cmd === "savedoc" && this.rootID && data.data?.rootID === this.rootID) {
            this.update();
        }
    }

    public update(protyle?: IProtyle) {
        if (protyle !== undefined) {
            this.protyle = protyle;
            this.rootID = protyle?.block?.rootID || "";
        }
        if (!this.protyle || !this.rootID || !this.protyle.element.isConnected ||
            this.protyle.block.rootID !== this.rootID) {
            this.data = [];
            this.render();
            return;
        }
        const items: IInlineMemoItem[] = [];
        const counters = new Map<string, number>();
        this.protyle.wysiwyg.element.querySelectorAll('[data-type~="inline-memo"]').forEach((span) => {
            const block = hasClosestByAttribute(span, "data-node-id", null);
            if (!block) {
                return;
            }
            const blockID = block.getAttribute("data-node-id");
            const index = counters.get(blockID) || 0;
            counters.set(blockID, index + 1);
            items.push({
                blockID,
                index,
                anchor: span.textContent || "",
                memo: decodeInlineMemoContent(span.getAttribute("data-inline-memo-content") || "")
            });
        });
        this.data = items;
        this.render();
    }

    private render() {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = inputElement.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const items = keywords.length === 0 ? this.data : this.data.filter(item => {
            const text = `${item.memo || ""} ${item.anchor || ""}`.toLowerCase();
            return keywords.every(keyword => text.includes(keyword));
        });
        if (items.length === 0) {
            this.listElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            return;
        }
        this.listElement.innerHTML = `<ul>${items.map((item, position) => {
            const anchorText = item.anchor.length > PREVIEW_LIMIT ? item.anchor.slice(0, PREVIEW_LIMIT) + "..." : item.anchor;
            return `<li class="b3-list-item b3-list-item--narrow" data-node-id="${escapeAttr(item.blockID)}" data-position="${position}">
    <span class="b3-list-item__text" title="${escapeAttr(item.anchor)}">${escapeHtml(anchorText)}</span>
    <span class="b3-list-item__meta" title="${escapeAttr(item.memo)}">${escapeHtml(item.memo)}</span>
    <span class="b3-list-item__action" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
</li>`;
        }).join("")}</ul>`;
    }

    private startEdit(itemElement: HTMLElement) {
        if (itemElement.querySelector("input")) {
            return;
        }
        const position = parseInt(itemElement.getAttribute("data-position") || "-1", 10);
        const current = Number.isInteger(position) ? this.getFilteredItems()[position] : undefined;
        if (!current) {
            return;
        }
        const textElement = itemElement.querySelector(".b3-list-item__text") as HTMLElement;
        const inputElement = document.createElement("input");
        inputElement.className = "b3-text-field fn__block";
        inputElement.value = current.memo;
        inputElement.placeholder = window.siyuan.languages.memo;
        textElement.replaceWith(inputElement);
        inputElement.focus();
        inputElement.select();
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            if (!save || inputElement.value === current.memo) {
                this.render();
                return;
            }
            this.saveMemo(current, inputElement.value);
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

    private getFilteredItems(): IInlineMemoItem[] {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = inputElement.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (keywords.length === 0) {
            return this.data;
        }
        return this.data.filter(item => {
            const text = `${item.memo || ""} ${item.anchor || ""}`.toLowerCase();
            return keywords.every(keyword => text.includes(keyword));
        });
    }

    private saveMemo(item: IInlineMemoItem, value: string) {
        if (!this.protyle || !this.protyle.element.isConnected) {
            this.update();
            return;
        }
        const blockElement = this.protyle.wysiwyg.element.querySelector(`[data-node-id="${CSS.escape(item.blockID)}"]`);
        if (!blockElement) {
            this.update();
            return;
        }
        const spans = blockElement.querySelectorAll('[data-type~="inline-memo"]');
        const span = spans[item.index];
        if (!span) {
            this.update();
            return;
        }
        const oldHTML = blockElement.outerHTML;
        if (value) {
            span.setAttribute("data-inline-memo-content", encodeInlineMemoContent(value));
        } else {
            // 空值移除行级备注类型并保留划线文本，与编辑器工具栏的处理一致
            const types = (span.getAttribute("data-type") || "").split(" ").filter(type => type && type !== "inline-memo");
            if (types.length === 0) {
                span.outerHTML = span.innerHTML;
            } else {
                span.setAttribute("data-type", types.join(" "));
                span.removeAttribute("data-inline-memo-content");
            }
        }
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(this.protyle, blockElement, oldHTML);
        this.update();
    }
}
