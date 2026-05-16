declare module "node:fs" {
  export function readFileSync(path: string, encoding: BufferEncoding): string;
}

declare module "node:process" {
  export const stdin: {
    setEncoding(encoding: BufferEncoding): void;
    on(event: "data", listener: (chunk: string) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  };
}

declare const process: {
  argv: string[];
  exitCode?: number;
};

type BufferEncoding = "utf8";
