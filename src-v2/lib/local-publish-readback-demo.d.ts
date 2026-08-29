import type {
  ProductDocumentState,
  PublishComplianceRevalidation,
  SpuRelationshipReadback,
} from "./api";

export declare const localPublishReadbackDemo: {
  mode: "local-field-demo";
  label: "本地字段演示";
  spuName: string;
  version: string;
  warning: string;
};

export declare function runLocalPublishReadbackDemo(input: {
  spuName: string;
  version: string;
}): {
  documentState: Omit<ProductDocumentState, "mode"> & {
    mode: "local-field-demo";
  };
  readback: Omit<SpuRelationshipReadback, "mode"> & {
    mode: "local-field-demo";
  };
  compliance: PublishComplianceRevalidation;
};
