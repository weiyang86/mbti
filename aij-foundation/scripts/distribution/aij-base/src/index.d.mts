export interface AijBasePackageInfo {
  readonly name: "@aij/base";
  readonly version: "0.1.0";
  readonly private: true;
  readonly distribution: "LOCAL_PRIVATE_PACK_ONLY";
}

export interface MaterializedProject {
  readonly destination: string;
  readonly filesWritten: number;
  readonly packageName: "@aij/base";
  readonly packageVersion: "0.1.0";
}

export interface MaterializeProjectOptions {
  destination: string;
}

export declare function getPackageInfo(): AijBasePackageInfo;
export declare function materializeProject(options: MaterializeProjectOptions): MaterializedProject;
