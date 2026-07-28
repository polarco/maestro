import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { safeStorage } from "electron";
import type { VaultStatus } from "@maestro/contracts";
import type { MaestroRepository, SecretRecord } from "@maestro/database";
import { MaestroError } from "@maestro/core";

const scrypt = promisify(scryptCallback);
const VERIFIER_KEY = "__vault_verifier__";
const VERIFIER_TEXT = "maestro-password-vault-v1";

function encryptedRecord(
  key: string,
  plaintext: string,
  encryptionKey: Buffer,
  salt: Buffer,
): SecretRecord {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    key,
    backend: "password-vault",
    encrypted: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

function decryptRecord(record: SecretRecord, encryptionKey: Buffer): string {
  if (!record.iv || !record.tag)
    throw new MaestroError("INVALID_SECRET_RECORD", "Registro criptografado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export class VaultService {
  readonly #repository: MaestroRepository;
  #passwordKey: Buffer | null = null;
  #passwordSalt: Buffer | null = null;

  constructor(repository: MaestroRepository) {
    this.#repository = repository;
  }

  #usesSecureStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform !== "linux") return true;
    const selected = safeStorage.getSelectedStorageBackend();
    return selected !== "basic_text" && selected !== "unknown";
  }

  async status(): Promise<VaultStatus> {
    const secure = this.#usesSecureStorage();
    const verifier = await this.#repository.getSecret(VERIFIER_KEY);
    if (secure) {
      return {
        backend: "safe-storage",
        secure: true,
        locked: false,
        hasPassword: verifier !== null,
        message: "Segredos protegidos pelo cofre do sistema operacional.",
      };
    }
    return {
      backend: "password-vault",
      secure: false,
      locked: this.#passwordKey === null,
      hasPassword: verifier !== null,
      message: this.#passwordKey
        ? "Cofre local desbloqueado para esta sessão."
        : "O Secret Service seguro não está disponível; desbloqueie o cofre local.",
    };
  }

  async unlock(password: string): Promise<VaultStatus> {
    if (this.#usesSecureStorage()) return this.status();
    if (password.length < 8)
      throw new MaestroError("WEAK_VAULT_PASSWORD", "Use uma senha com pelo menos 8 caracteres.", {
        recoverable: true,
      });
    const verifier = await this.#repository.getSecret(VERIFIER_KEY);
    const salt = verifier?.salt ? Buffer.from(verifier.salt, "base64") : randomBytes(16);
    const derived = (await scrypt(password, salt, 32)) as Buffer;

    if (verifier) {
      let plaintext: string;
      try {
        plaintext = decryptRecord(verifier, derived);
      } catch {
        derived.fill(0);
        throw new MaestroError("INVALID_VAULT_PASSWORD", "Senha do cofre incorreta.", {
          recoverable: true,
        });
      }
      const valid = timingSafeEqual(Buffer.from(plaintext), Buffer.from(VERIFIER_TEXT));
      if (!valid) {
        derived.fill(0);
        throw new MaestroError("INVALID_VAULT_PASSWORD", "Senha do cofre incorreta.", {
          recoverable: true,
        });
      }
    } else {
      await this.#repository.setSecret(encryptedRecord(VERIFIER_KEY, VERIFIER_TEXT, derived, salt));
    }

    this.lock();
    this.#passwordKey = derived;
    this.#passwordSalt = salt;
    return this.status();
  }

  lock(): void {
    this.#passwordKey?.fill(0);
    this.#passwordKey = null;
    this.#passwordSalt = null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null || value === "") {
      await this.#repository.deleteSecret(key);
      return;
    }
    if (this.#usesSecureStorage()) {
      const encrypted = safeStorage.encryptString(value);
      await this.#repository.setSecret({
        key,
        backend: "safe-storage",
        encrypted: encrypted.toString("base64"),
        salt: null,
        iv: null,
        tag: null,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (!this.#passwordKey || !this.#passwordSalt) {
      throw new MaestroError("VAULT_LOCKED", "Desbloqueie o cofre antes de salvar uma chave.", {
        recoverable: true,
      });
    }
    await this.#repository.setSecret(
      encryptedRecord(key, value, this.#passwordKey, this.#passwordSalt),
    );
  }

  async get(key: string): Promise<string | null> {
    const record = await this.#repository.getSecret(key);
    if (!record) return null;
    if (record.backend === "safe-storage") {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new MaestroError(
          "SAFE_STORAGE_UNAVAILABLE",
          "O cofre do sistema não está disponível nesta sessão.",
          { recoverable: true },
        );
      }
      return safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
    }
    if (!this.#passwordKey)
      throw new MaestroError("VAULT_LOCKED", "O cofre local está bloqueado.", {
        recoverable: true,
      });
    return decryptRecord(record, this.#passwordKey);
  }

  has(key: string): Promise<boolean> {
    return this.#repository.hasSecret(key);
  }
}
