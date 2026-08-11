import {
  createReadStream,
  promises as fs,
} from "fs";
import {
  createServer,
  type Server,
  type ServerResponse,
} from "http";
import {
  type AddressInfo,
} from "net";
import * as path from "path";
import {
  fileURLToPath,
} from "url";

type LocalHtmlRegistration = {
  entryPath: string;
  rootPath: string;
};

const HTML_EXTENSIONS = new Set([".htm", ".html"]);

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

export const isLocalHtmlReference = (value: string): boolean => {
  const candidate = value.trim();
  if (/^file:/i.test(candidate)) {
    return true;
  }
  return path.isAbsolute(candidate) && HTML_EXTENSIONS.has(path.extname(candidate).toLowerCase());
};

const toLocalPath = (value: string): string => {
  const candidate = value.trim();
  if (/^file:/i.test(candidate)) {
    const fileUrl = new URL(candidate);
    if (fileUrl.protocol !== "file:") {
      throw new Error("仅支持本地 file URL");
    }
    return fileURLToPath(fileUrl);
  }
  if (!path.isAbsolute(candidate)) {
    throw new Error("本地 HTML 必须使用绝对路径");
  }
  return path.normalize(candidate);
};

const isInsideRoot = (rootPath: string, candidatePath: string): boolean => {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === ""
    || (
      relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    );
};

const sendStatus = (response: ServerResponse, statusCode: number, message: string): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
};

export class LocalHtmlBridge {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly registrations = new Map<string, LocalHtmlRegistration>();
  private readonly tokensByEntryPath = new Map<string, string>();

  createUrl = async (value: string): Promise<string> => {
    const requestedPath = toLocalPath(value);
    if (!HTML_EXTENSIONS.has(path.extname(requestedPath).toLowerCase())) {
      throw new Error("仅支持 .html 和 .htm 文件");
    }

    const requestedStat = await fs.stat(requestedPath);
    if (!requestedStat.isFile()) {
      throw new Error("本地 HTML 路径不是文件");
    }

    const entryPath = await fs.realpath(requestedPath);
    const rootPath = await fs.realpath(path.dirname(entryPath));
    let token = this.tokensByEntryPath.get(entryPath);
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      this.tokensByEntryPath.set(entryPath, token);
      this.registrations.set(token, { entryPath, rootPath });
    }

    await this.ensureServer();
    const encodedName = encodeURIComponent(path.basename(entryPath));
    return `http://127.0.0.1:${this.port}/${token}/${encodedName}`;
  };

  close = (): void => {
    const server = this.server;
    this.server = null;
    this.port = null;
    this.registrations.clear();
    this.tokensByEntryPath.clear();
    server?.close();
  };

  private ensureServer = async (): Promise<void> => {
    if (this.server && this.port !== null) {
      return;
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request.url ?? "/", request.method ?? "GET", response);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });

    const address = server.address() as AddressInfo | null;
    if (!address) {
      server.close();
      throw new Error("本地 HTML 服务启动失败");
    }
    server.unref();
    this.server = server;
    this.port = address.port;
  };

  private handleRequest = async (
    requestUrl: string,
    method: string,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      if (method !== "GET" && method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendStatus(response, 405, "Method not allowed");
        return;
      }

      const parsedUrl = new URL(requestUrl, "http://127.0.0.1");
      const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
      const token = pathSegments.shift();
      const registration = token ? this.registrations.get(token) : undefined;
      if (!registration) {
        sendStatus(response, 404, "Not found");
        return;
      }

      const relativePath = pathSegments.length === 0
        ? path.basename(registration.entryPath)
        : pathSegments.map((segment) => decodeURIComponent(segment)).join(path.sep);
      let candidatePath = path.resolve(registration.rootPath, relativePath);
      if (!isInsideRoot(registration.rootPath, candidatePath)) {
        sendStatus(response, 403, "Forbidden");
        return;
      }

      let candidateStat = await fs.stat(candidatePath);
      if (candidateStat.isDirectory()) {
        candidatePath = path.join(candidatePath, "index.html");
        candidateStat = await fs.stat(candidatePath);
      }
      if (!candidateStat.isFile()) {
        sendStatus(response, 404, "Not found");
        return;
      }

      const realCandidatePath = await fs.realpath(candidatePath);
      if (!isInsideRoot(registration.rootPath, realCandidatePath)) {
        sendStatus(response, 403, "Forbidden");
        return;
      }

      const contentType = MIME_TYPES[path.extname(realCandidatePath).toLowerCase()]
        ?? "application/octet-stream";
      response.statusCode = 200;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", contentType);
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (method === "HEAD") {
        response.end();
        return;
      }

      const fileStream = createReadStream(realCandidatePath);
      fileStream.on("error", () => {
        if (!response.headersSent) {
          sendStatus(response, 500, "Unable to read file");
        } else {
          response.destroy();
        }
      });
      fileStream.pipe(response);
    } catch (error) {
      const errorCode = error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
      if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
        sendStatus(response, 404, "Not found");
        return;
      }
      sendStatus(response, 500, "Unable to serve local HTML");
    }
  };
}
