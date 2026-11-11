// DejaVu - Data snapshot and sync.
// Copyright (c) 2022-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package cloud

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	as3 "github.com/aws/aws-sdk-go-v2/service/s3"
	as3Types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestS3GetNotFoundConcurrentResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "present") {
			w.Header().Set("Content-Length", "1")
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	s3 := NewS3(&BaseCloud{Conf: &Conf{S3: &ConfS3{Endpoint: server.URL, Bucket: "bucket",
		Region: "test", AccessKey: "test", SecretKey: "test", PathStyle: true, Timeout: 5, ConcurrentReqs: 16}}}, server.Client())
	keys := []string{"present"}
	for i := 0; i < 256; i++ {
		keys = append(keys, fmt.Sprintf("missing-%d", i))
	}
	for iteration := 0; iteration < 3; iteration++ {
		missing, err := s3.getNotFound(keys)
		if err != nil {
			t.Fatal(err)
		}
		found := map[string]bool{}
		for _, key := range missing {
			if key == "present" || found[key] {
				t.Fatalf("unexpected missing key: %s", key)
			}
			found[key] = true
		}
		if len(found) != len(keys)-1 {
			t.Fatalf("missing results: got %d, want %d", len(found), len(keys)-1)
		}
		for _, key := range keys[1:] {
			if !found[key] {
				t.Fatalf("lost missing key: %s", key)
			}
		}
	}
}

type listObjectsStub struct {
	pages    []*as3.ListObjectsOutput
	errAt    int
	pageErr  error
	markers  []string
	calls    int
	v2Pages  []*as3.ListObjectsV2Output
	v2Err    error
	v2Calls  int
	v2Tokens []string
}

func (stub *listObjectsStub) ListObjects(_ context.Context, input *as3.ListObjectsInput,
	_ ...func(*as3.Options)) (*as3.ListObjectsOutput, error) {
	marker := ""
	if nil != input.Marker {
		marker = *input.Marker
	}
	stub.markers = append(stub.markers, marker)
	call := stub.calls
	stub.calls++
	if call == stub.errAt {
		return nil, stub.pageErr
	}
	return stub.pages[call], nil
}

func (stub *listObjectsStub) ListObjectsV2(_ context.Context, input *as3.ListObjectsV2Input,
	_ ...func(*as3.Options)) (*as3.ListObjectsV2Output, error) {
	token := ""
	if nil != input.ContinuationToken {
		token = *input.ContinuationToken
	}
	stub.v2Tokens = append(stub.v2Tokens, token)
	stub.v2Calls++
	if nil != stub.v2Err {
		return nil, stub.v2Err
	}
	return stub.v2Pages[stub.v2Calls-1], nil
}

// newV1OnlyStub 构造仅支持 ListObjects(V1) 的桩，V2 一律报错，用于验证回退路径。
func newV1OnlyStub(pages []*as3.ListObjectsOutput) *listObjectsStub {
	return &listObjectsStub{
		errAt: -1,
		v2Err: errors.New("not implemented"),
		pages: pages,
	}
}

func TestListS3ObjectsPrefersV2Pagination(t *testing.T) {
	firstPage := make([]as3Types.Object, 32)
	for i := range firstPage {
		firstPage[i].Key = aws.String(fmt.Sprintf("repo/refs/tags/%02d", i))
	}
	stub := &listObjectsStub{
		errAt: -1,
		v2Pages: []*as3.ListObjectsV2Output{
			{
				Contents:              firstPage,
				IsTruncated:           aws.Bool(true),
				NextContinuationToken: aws.String("token-1"),
			},
			{
				Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/32")}},
				IsTruncated: aws.Bool(false),
			},
		},
	}
	limit := int32(32)
	objects, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket:  aws.String("bucket"),
		Prefix:  aws.String("repo/refs/tags/"),
		MaxKeys: &limit,
	})
	if nil != err {
		t.Fatal(err)
	}
	if 33 != len(objects) {
		t.Fatalf("unexpected object count [%d]", len(objects))
	}
	if 2 != stub.v2Calls || 0 != stub.calls || 2 != len(stub.v2Tokens) || "" != stub.v2Tokens[0] || "token-1" != stub.v2Tokens[1] {
		t.Fatalf("unexpected v2 calls [%d] and tokens [%v]", stub.v2Calls, stub.v2Tokens)
	}
}

func TestListS3ObjectsFallsBackToV1WhenV2Unsupported(t *testing.T) {
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{
			Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
			IsTruncated: aws.Bool(false),
		},
	})
	objects, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
		Prefix: aws.String("repo/refs/tags/"),
	})
	if nil != err {
		t.Fatal(err)
	}
	if 1 != len(objects) || 1 != stub.v2Calls || 1 != stub.calls {
		t.Fatalf("unexpected objects [%d], v2 calls [%d], v1 calls [%d]", len(objects), stub.v2Calls, stub.calls)
	}
}

func TestListS3ObjectsV2RejectsRepeatedContinuationToken(t *testing.T) {
	stub := &listObjectsStub{
		errAt: -1,
		v2Pages: []*as3.ListObjectsV2Output{
			{
				Contents:              []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
				IsTruncated:           aws.Bool(true),
				NextContinuationToken: aws.String("token-a"),
			},
			{
				Contents:              []as3Types.Object{{Key: aws.String("repo/refs/tags/01")}},
				IsTruncated:           aws.Bool(true),
				NextContinuationToken: aws.String("token-b"),
			},
			{
				Contents:              []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
				IsTruncated:           aws.Bool(true),
				NextContinuationToken: aws.String("token-a"),
			},
		},
	}
	_, err := listS3ObjectsV2(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
	})
	if nil == err || "list objects v2 continuation token did not advance" != err.Error() {
		t.Fatalf("unexpected repeated token error [%v]", err)
	}
	if 3 != stub.v2Calls {
		t.Fatalf("unexpected v2 calls [%d]", stub.v2Calls)
	}
}

func TestListS3ObjectsV2RejectsEmptyContinuationToken(t *testing.T) {
	stub := &listObjectsStub{
		errAt: -1,
		v2Pages: []*as3.ListObjectsV2Output{
			{
				Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
				IsTruncated: aws.Bool(true),
			},
		},
	}
	_, err := listS3ObjectsV2(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
	})
	if nil == err || "list objects v2 continuation token is empty" != err.Error() {
		t.Fatalf("unexpected v2 token error [%v]", err)
	}
}

func TestListS3ObjectsPagination(t *testing.T) {
	firstPage := make([]as3Types.Object, 32)
	for i := range firstPage {
		firstPage[i].Key = aws.String(fmt.Sprintf("repo/refs/tags/%02d", i))
	}
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{
			Contents:    firstPage,
			IsTruncated: aws.Bool(true),
			NextMarker:  aws.String("repo/refs/tags/31"),
		},
		{
			Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/32")}},
			IsTruncated: aws.Bool(false),
		},
	})
	limit := int32(32)
	objects, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket:  aws.String("bucket"),
		Prefix:  aws.String("repo/refs/tags/"),
		MaxKeys: &limit,
	})
	if nil != err {
		t.Fatal(err)
	}
	if 33 != len(objects) {
		t.Fatalf("unexpected object count [%d]", len(objects))
	}
	if 2 != stub.calls || 2 != len(stub.markers) || "" != stub.markers[0] || "repo/refs/tags/31" != stub.markers[1] {
		t.Fatalf("unexpected pagination calls [%d] and markers [%v]", stub.calls, stub.markers)
	}
}

func TestListS3ObjectsReturnsPaginationError(t *testing.T) {
	wantErr := errors.New("list page failed")
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{
			Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
			IsTruncated: aws.Bool(true),
			NextMarker:  aws.String("repo/refs/tags/00"),
		},
	})
	stub.errAt = 1
	stub.pageErr = wantErr
	_, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
		Prefix: aws.String("repo/refs/tags/"),
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("unexpected pagination error [%v]", err)
	}
}

func TestListS3ObjectsUsesLastKeyAsMarker(t *testing.T) {
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{
			Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/00")}},
			IsTruncated: aws.Bool(true),
		},
		{
			Contents:    []as3Types.Object{{Key: aws.String("repo/refs/tags/01")}},
			IsTruncated: aws.Bool(false),
		},
	})
	objects, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
		Prefix: aws.String("repo/refs/tags/"),
	})
	if nil != err {
		t.Fatal(err)
	}
	if 2 != len(objects) || 2 != stub.calls || "repo/refs/tags/00" != stub.markers[1] {
		t.Fatalf("unexpected objects [%d], calls [%d], and markers [%v]", len(objects), stub.calls, stub.markers)
	}
}

func TestListS3ObjectsRejectsUnchangedMarker(t *testing.T) {
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{
			IsTruncated: aws.Bool(true),
			NextMarker:  aws.String("marker"),
		},
	})
	_, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
		Marker: aws.String("marker"),
	})
	if nil == err || "list objects marker did not advance" != err.Error() {
		t.Fatalf("unexpected marker error [%v]", err)
	}
}

func TestListS3ObjectsReturnsEmptyList(t *testing.T) {
	stub := newV1OnlyStub([]*as3.ListObjectsOutput{
		{IsTruncated: aws.Bool(false)},
	})
	objects, err := listS3Objects(context.Background(), stub, &as3.ListObjectsInput{
		Bucket: aws.String("bucket"),
		Prefix: aws.String("repo/refs/tags/"),
	})
	if nil != err {
		t.Fatal(err)
	}
	if nil == objects || 0 != len(objects) {
		t.Fatalf("unexpected objects [%v]", objects)
	}
}
