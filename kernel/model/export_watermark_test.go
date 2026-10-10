package model

import (
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

// newWatermarkTestContext 构造只含单页的内存 PDF 上下文，用于水印处理回归测试
func newWatermarkTestContext(t *testing.T) *model.Context {
	t.Helper()
	xRefTable, err := pdfcpu.CreateXRefTableWithRootDict()
	if err != nil {
		t.Fatal(err)
	}
	rootDict, err := xRefTable.Catalog()
	if err != nil {
		t.Fatal(err)
	}
	mediaBox := types.RectForFormat("A4")
	if err = pdfcpu.AddPageTreeWithSamplePage(xRefTable, rootDict, model.NewPage(mediaBox, mediaBox)); err != nil {
		t.Fatal(err)
	}
	if err = xRefTable.EnsurePageCount(); err != nil {
		t.Fatal(err)
	}
	return pdfcpu.CreateContext(xRefTable, nil)
}

func TestExportWatermarkDefaultsAndGuards(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Export = conf.NewExport()
	t.Cleanup(func() { Conf = originalConf })

	// 默认导出配置不得携带任何强制水印
	if "" != Conf.Export.PDFWatermarkStr || "" != Conf.Export.PDFWatermarkDesc ||
		"" != Conf.Export.ImageWatermarkStr || "" != Conf.Export.ImageWatermarkDesc {
		t.Fatalf("default export config should not contain watermarks: %+v", Conf.Export)
	}

	ctx := newWatermarkTestContext(t)
	before := len(ctx.XRefTable.Table)

	// watermark=false 时不处理 PDF
	processPDFWatermark(ctx, false)
	if got := len(ctx.XRefTable.Table); got != before {
		t.Fatalf("watermark=false should not add PDF objects: before=%d after=%d", before, got)
	}

	// watermark=true 但水印文本为空时仍不处理 PDF
	Conf.Export.PDFWatermarkStr = ""
	processPDFWatermark(ctx, true)
	if got := len(ctx.XRefTable.Table); got != before {
		t.Fatalf("empty watermark string should not add PDF objects: before=%d after=%d", before, got)
	}

	// 显式配置水印后不再被拦截，处理会实际加入水印对象
	Conf.Export.PDFWatermarkStr = "siyuan-export-watermark"
	processPDFWatermark(ctx, true)
	if got := len(ctx.XRefTable.Table); got <= before {
		t.Fatalf("configured watermark should engage PDF watermark processing: before=%d after=%d", before, got)
	}
}
