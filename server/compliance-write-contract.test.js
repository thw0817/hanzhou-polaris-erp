import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgencyBindBody,
  buildCertificateBindBody,
  buildCertificatePresetInfoList,
  buildCertificateSaveBody,
  buildCertificateUploadRequest,
  buildPhotoBindBody,
  buildPhotoUploadRequest,
  buildWarningUpdateBody,
  parseCertificateBindResponse,
  parseCertificateSaveResponse,
  parsePhotoBindResponse,
  SHEIN_COMPLIANCE_WRITE_PATHS,
} from "./compliance-write-contract.js";

test("builds certificate upload and save bodies from official fields", () => {
  assert.deepEqual(
    buildCertificateUploadRequest({
      fileName: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
    }),
    {
      method: "POST",
      path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
      multipartField: "file",
      fileName: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
    },
  );

  const presetInfoList = buildCertificatePresetInfoList({
    schema: {
      presetInfoList: [
        {
          presetId: 175,
          inputType: 4,
          isRequired: 1,
          isEnabled: 1,
        },
      ],
      otherPresetInfoList: [
        {
          presetId: 183,
          inputType: 1,
          sourceFrom: "SRM",
          isRequired: 1,
          isEnabled: 1,
        },
      ],
    },
    fieldValues: {
      175: { value: "2027-01-01 00:00:00" },
      183: { detectionAgencyId: 16886285, laboratoryId: 16997191 },
    },
  });

  assert.deepEqual(
    buildCertificateSaveBody({
      certificateTypeCode: "3DD70084B6997DF",
      certificateDimension: 1,
      fileList: [
        {
          fileUrl: "https://example.test/report.pdf",
          fileMd5: "2230eacf3617c2a4604758ea3ae871b9",
          fileName: "report.pdf",
        },
      ],
      presetInfoList,
    }),
    {
      certificateTypeCode: "3DD70084B6997DF",
      certificateDimension: 1,
      poolSn: "",
      fileList: [
        {
          fileUrl: "https://example.test/report.pdf",
          fileMd5: "2230eacf3617c2a4604758ea3ae871b9",
          fileName: "report.pdf",
        },
      ],
      presetInfoList: [
        {
          presetId: 175,
          valueList: [{ value: "2027-01-01 00:00:00" }],
        },
        {
          presetId: 183,
          valueList: [{ valueId: 16886285, value: 16997191 }],
        },
      ],
    },
  );

  assert.deepEqual(
    buildCertificatePresetInfoList({
      schema: {
        presetInfoList: [{
          presetId: 175,
          inputType: 4,
          isRequired: 1,
          isEnabled: 1,
        }],
      },
      fieldValues: { 175: { value: "2027-01-01" } },
    }),
    [{ presetId: 175, valueList: [{ value: "2027-01-01 00:00:00" }] }],
  );
});

test("parses official certificate save and bind responses fail closed", () => {
  assert.deepEqual(
    parseCertificateSaveResponse({
      code: "0",
      info: { code: "0", poolSn: "ocp-1", existPoolSnList: null },
      traceId: "save-trace",
    }),
    { poolSn: "ocp-1", existPoolSnList: [], traceId: "save-trace" },
  );
  assert.deepEqual(
    parseCertificateBindResponse({ code: "0", info: {}, traceId: "bind-trace" }),
    { info: {}, traceId: "bind-trace" },
  );
  assert.throws(
    () => parseCertificateSaveResponse({
      code: "0",
      info: { code: "1001", failMsg: "报告日期无效" },
    }),
    /报告日期无效/,
  );
});

test("parses official photo bind partial failures as failures", () => {
  assert.deepEqual(
    parsePhotoBindResponse({
      code: "0",
      info: { totalCount: 1, successCount: 1, faildCount: 0, faildList: [] },
      traceId: "photo-trace",
    }),
    {
      totalCount: 1,
      successCount: 1,
      faildCount: 0,
      faildList: [],
      traceId: "photo-trace",
    },
  );
  assert.throws(
    () => parsePhotoBindResponse({
      code: "0",
      info: {
        totalCount: 1,
        successCount: 0,
        faildCount: 1,
        faildList: [{ skc: "SKC-1", code: "0108", reason: "无需上传" }],
      },
    }),
    /无需上传/,
  );
});

test("builds exact certificate and agency bind bodies", () => {
  assert.deepEqual(
    buildCertificateBindBody({
      poolSn: "ocp3437520192426127360",
      skcNames: ["rug-1", "rug-1", "rug-2"],
    }),
    {
      poolSn: "ocp3437520192426127360",
      skcNames: ["rug-1", "rug-2"],
    },
  );
  assert.deepEqual(
    buildAgencyBindBody({
      skc: ["rug-1"],
      agencyId: 456646002,
      agencyType: 0,
    }),
    {
      skc: ["rug-1"],
      agencyId: 456646002,
      agencyType: 0,
    },
  );
});

test("builds warning body with every enabled field and mapped warnings", () => {
  const body = buildWarningUpdateBody({
    certificateTypeCode: "PlaypenWMWAttr",
    skcNames: ["rug-1"],
    rules: {
      presetInfo: {
        presetFields: [
          {
            fieldCode: "PAWA1",
            fieldType: 0,
            fieldSort: 0,
            isEnabled: 1,
            presetFieldValues: [
              { fieldValueId: 2458, isEnabled: 1 },
            ],
          },
          {
            fieldCode: "WAContent",
            fieldType: 2,
            fieldSort: 1,
            isEnabled: 1,
            presetFieldValues: [
              {
                fieldValueId: 2457,
                isEnabled: 1,
                mappingPaths: [{ fieldValueIds: [2458] }],
              },
              {
                fieldValueId: 2456,
                isEnabled: 1,
                mappingPaths: [{ fieldValueIds: [2458] }],
              },
            ],
          },
        ],
      },
    },
    selectedByField: { PAWA1: [2458] },
  });

  assert.deepEqual(body, {
    certificateTypeCode: "PlaypenWMWAttr",
    skcNames: ["rug-1"],
    fieldList: [
      {
        fieldCode: "PAWA1",
        fieldValues: [{ fieldValueId: 2458 }],
      },
      {
        fieldCode: "WAContent",
        fieldValues: [
          { fieldValueId: 2457 },
          { fieldValueId: 2456 },
        ],
      },
    ],
  });
});

test("validates official compliance photo upload limits", () => {
  assert.equal(
    buildPhotoUploadRequest({
      fileName: "rug.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      width: 2000,
      height: 2000,
    }).path,
    SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
  );
  assert.throws(
    () =>
      buildPhotoUploadRequest({
        fileName: "rug.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        width: 8001,
        height: 2000,
      }),
    /8000px/,
  );
});

test("builds exact official photo binding groups without deprecated fields", () => {
  assert.deepEqual(
    buildPhotoBindBody({
      skcList: ["rug-1", "rug-1"],
      packageLableList: [
        {
          imageUrl: "https://image.example/inner.jpg",
          imageMd5: "inner-md5",
          photoSlot: "inner_package",
        },
        {
          imageUrl: "https://image.example/outer.jpg",
          imageMd5: "outer-md5",
        },
      ],
      bodyLableList: [
        {
          imageUrl: "https://image.example/body.jpg",
          imageMd5: "body-md5",
        },
      ],
      skcLablePicList: [
        { imageUrl: "https://deprecated.example/old.jpg", imageMd5: "old" },
      ],
    }),
    {
      skcList: ["rug-1"],
      packageLableList: [
        {
          imageUrl: "https://image.example/inner.jpg",
          imageMd5: "inner-md5",
        },
        {
          imageUrl: "https://image.example/outer.jpg",
          imageMd5: "outer-md5",
        },
      ],
      bodyLableList: [
        {
          imageUrl: "https://image.example/body.jpg",
          imageMd5: "body-md5",
        },
      ],
    },
  );
});

test("rejects photo binding without an SKC, a photo group, or upload receipts", () => {
  assert.throws(
    () => buildPhotoBindBody({ packageLableList: [{ imageUrl: "x", imageMd5: "y" }] }),
    /skcList is required/,
  );
  assert.throws(
    () => buildPhotoBindBody({ skcList: ["rug-1"] }),
    /packageLableList or bodyLableList is required/,
  );
  assert.throws(
    () => buildPhotoBindBody({
      skcList: ["rug-1"],
      packageLableList: [{ imageUrl: "https://image.example/inner.jpg" }],
    }),
    /imageMd5 is required/,
  );
});
