interface AijBasePackageInfo {
  readonly name: "@aij/base";
  readonly version: "0.1.0";
  readonly private: true;
  readonly distribution: "LOCAL_PRIVATE_PACK_ONLY";
}

interface MaterializedProject {
  readonly destination: string;
  readonly filesWritten: number;
  readonly packageName: "@aij/base";
  readonly packageVersion: "0.1.0";
}

interface MaterializeProjectOptions {
  destination: string;
}

declare const aijBase: {
  getPackageInfo(): AijBasePackageInfo;
  materializeProject(options: MaterializeProjectOptions): MaterializedProject;
};

export = aijBase;
