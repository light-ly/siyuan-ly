import dayjs from "dayjs";
import {bindPanelSearch} from "../../layout/dock/panelSearch";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openMobileFileById} from "../editor";
import type {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {showMobileFilterInput} from "./mobileFilterInput";
import {decodeInlineMemoContent, encodeInlineMemoContent} from "../../protyle/util/inlineMemo";
import {updateTransaction} from "../../protyle/wysiwyg/transaction";
import {escapeAttr, escapeHtml} from "../../util/escape";

interface IInlineMemoItem {
    blockID: string;
    indexes: number[]; // 块内组成该条备注的 span 序号（应用备注时按格式边界拆分的片段）
    anchor: string; // 划线文本
    memo: string; // 备注内容
}

interface IMemoGroup extends IInlineMemoItem {
    rawAttr: string;
    lastSpan: Element;
}

const ANCHOR_LIMIT = 80;

// 同块内两个备注 span 之间的间隙：返回间隙文本（供拼接引用），无法连通（跨块）返回 null。
// 划线文本含行内代码等元素时备注会被拆成多段，间隙允许存在行内元素；纯文本间隙超过阈值视为两条独立备注。
const MEMO_GAP_TEXT_LIMIT = 2;
const gapBetweenMemoSpans = (previous: Element, current: Element): string | null => {
    let node = previous.nextSibling;
    let gap = "";
    while (node && node !== current) {
        if (node.nodeType === 1 && (node as Element).hasAttribute("data-node-id")) {
            return null;
        }
        if (node.nodeType === 1 && node.nodeName === "BR") {
            gap += "\n";
        } else {
            gap += node.textContent || "";
        }
        node = node.nextSibling;
    }
    if (node !== current) {
        return null;
    }
    if (gap.split(Constants.ZWSP).join("").replace(/\s+/g, "").length > MEMO_GAP_TEXT_LIMIT) {
        return null;
    }
    return gap;
};

export class MobileMemo {
    public element: HTMLElement;
    private listElement: HTMLElement;
    private data: IInlineMemoItem[] = [];
    private protyle: IProtyle;
    private rootID = "";

    constructor(app: App, element: HTMLElement) {
        this.element = element;
        this.element.innerHTML = `<div class="toolbar toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.memo}
    </div>
    <span class="fn__space"></span>
    <input spellcheck="false" class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <svg data-type="search" class="toolbar__icon"><use xlink:href='#iconSearch'></use></svg>
    <span class="fn__space"></span>
    <svg data-type="refresh" class="toolbar__icon"><use xlink:href='#iconRefresh'></use></svg>
</div>
<div class="fn__flex-1 memoList"></div>`;
        this.listElement = this.element.querySelector(".memoList") as HTMLElement;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        bindPanelSearch(inputElement,
            this.element.querySelector('[data-type="search"]'), () => this.render(), {
                activeClass: "toolbar__icon--active", updateLabel: false,
            });
        this.element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).tagName === "INPUT" ||
                (event.target as HTMLElement).tagName === "TEXTAREA") {
                return;
            }
            const iconElement = hasClosestByClassName(event.target as HTMLElement, "toolbar__icon");
            if (iconElement) {
                const type = iconElement.getAttribute("data-type");
                if (type === "search") {
                    showMobileFilterInput(inputElement, iconElement);
                } else if (type === "refresh") {
                    this.update();
                }
                return;
            }
            const cardElement = hasClosestByClassName(event.target as HTMLElement, "memo-card");
            if (!cardElement) {
                return;
            }
            if (hasClosestByClassName(event.target as HTMLElement, "memo-card__content")) {
                this.startEdit(cardElement);
                return;
            }
            const id = cardElement.getAttribute("data-node-id");
            checkFold(id, (zoomIn) => {
                openMobileFileById(app, id, zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL], "start");
            });
        });
        this.update();
    }

    public update(protyle?: IProtyle) {
        if (protyle !== undefined) {
            this.protyle = protyle;
            this.rootID = protyle?.block?.rootID || "";
        } else {
            this.protyle = window.siyuan.mobile?.editor?.protyle;
            this.rootID = this.protyle?.block?.rootID || "";
        }
        if (!this.protyle || !this.rootID || !this.protyle.element.isConnected ||
            this.protyle.block.rootID !== this.rootID) {
            this.data = [];
            this.render();
            return;
        }
        // 同一备注在应用时会被拆成相邻的多个 span（格式边界），这里按块 + 原始属性 + 相邻关系归并为一条
        const items: IInlineMemoItem[] = [];
        const counters = new Map<string, number>();
        let current: IMemoGroup | undefined;
        this.protyle.wysiwyg.element.querySelectorAll('[data-type~="inline-memo"]').forEach((span) => {
            const block = hasClosestByAttribute(span, "data-node-id", null);
            if (!block) {
                current = undefined;
                return;
            }
            const blockID = block.getAttribute("data-node-id");
            const index = counters.get(blockID) || 0;
            counters.set(blockID, index + 1);
            const rawAttr = span.getAttribute("data-inline-memo-content") || "";
            const gap = current && current.blockID === blockID && current.rawAttr === rawAttr ?
                gapBetweenMemoSpans(current.lastSpan, span) : null;
            if (current && gap !== null) {
                current.indexes.push(index);
                current.anchor += gap + (span.textContent || "");
                current.lastSpan = span;
                return;
            }
            current = {
                blockID,
                indexes: [index],
                anchor: span.textContent || "",
                memo: decodeInlineMemoContent(rawAttr),
                rawAttr,
                lastSpan: span
            };
            items.push(current);
        });
        this.data = items;
        this.render();
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

    private render() {
        const items = this.getFilteredItems();
        if (items.length === 0) {
            this.listElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            return;
        }
        this.listElement.innerHTML = items.map((item, position) => {
            const anchorText = item.anchor.length > ANCHOR_LIMIT ? item.anchor.slice(0, ANCHOR_LIMIT) + "..." : item.anchor;
            const contentClass = item.memo ? "memo-card__content" : "memo-card__content memo-card__content--empty";
            return `<div class="memo-card" data-node-id="${escapeAttr(item.blockID)}" data-position="${position}">
    <div class="memo-card__quote" title="${escapeAttr(item.anchor)}">${escapeHtml(anchorText)}</div>
    <div class="memo-card__row">
        <div class="${contentClass}" title="${escapeAttr(item.memo)}">${escapeHtml(item.memo) || window.siyuan.languages.memo}</div>
        <span class="block__icon memo-card__edit" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    </div>
</div>`;
        }).join("");
    }

    private startEdit(cardElement: HTMLElement) {
        if (cardElement.querySelector("textarea")) {
            return;
        }
        const position = parseInt(cardElement.getAttribute("data-position") || "-1", 10);
        const current = Number.isInteger(position) ? this.getFilteredItems()[position] : undefined;
        if (!current) {
            return;
        }
        const contentElement = cardElement.querySelector(".memo-card__content") as HTMLElement;
        const textElement = document.createElement("textarea");
        textElement.className = "b3-text-field";
        textElement.rows = 1;
        textElement.value = current.memo;
        textElement.placeholder = window.siyuan.languages.memo;
        contentElement.replaceWith(textElement);
        const autoHeight = () => {
            textElement.style.height = "auto";
            textElement.style.height = textElement.scrollHeight + "px";
        };
        autoHeight();
        textElement.focus();
        textElement.setSelectionRange(textElement.value.length, textElement.value.length);
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            if (!save || textElement.value === current.memo) {
                this.render();
                return;
            }
            this.saveMemo(current, textElement.value);
        };
        textElement.addEventListener("input", autoHeight);
        textElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                finish(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
            }
        });
        textElement.addEventListener("blur", () => finish(true));
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
        const spans = Array.from(blockElement.querySelectorAll('[data-type~="inline-memo"]'));
        const targets = item.indexes.map(index => spans[index]).filter(span => !!span);
        if (targets.length === 0) {
            this.update();
            return;
        }
        const oldHTML = blockElement.outerHTML;
        targets.forEach(span => {
            if (value) {
                span.setAttribute("data-inline-memo-content", encodeInlineMemoContent(value));
            } else {
                // 空值移除行级备注类型并保留划线文本，与编辑器工具栏的处理一致
                const types = (span.getAttribute("data-type") || "").split(" ")
                    .filter(type => type && type !== "inline-memo");
                if (types.length === 0) {
                    span.outerHTML = span.innerHTML;
                } else {
                    span.setAttribute("data-type", types.join(" "));
                    span.removeAttribute("data-inline-memo-content");
                }
            }
        });
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(this.protyle, blockElement, oldHTML);
        this.update();
    }
}
