const fs = require("fs/promises");
const path = require("path");

class FileStateRepository {
  constructor(file) {
    this.file = file;
    this.kind = "file";
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async save(snapshot) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot));
    await fs.rename(tmp, this.file);
  }

  async health() {
    try {
      await fs.access(path.dirname(this.file));
      return { ok: true, backend: this.kind, file: this.file };
    } catch (err) {
      return { ok: false, backend: this.kind, error: err.message };
    }
  }

  async close() {}
}

module.exports = { FileStateRepository };
