import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";

const getEnv = () => process.env;

let client = null;
let bucketEnsured = false;

function getS3Client() {
  if (client) return client;

  const env = getEnv();
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 não configurado. Defina S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY."
    );
  }

  client = new S3Client({
    endpoint,
    region: env.S3_REGION || "garage",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

/**
 * Ensure the configured bucket exists, creating it if necessary.
 * Uses ListObjectsV2 instead of HeadBucket for reliable 404 detection
 * across S3-compatible services (HeadBucket returns 403 for non-existent
 * buckets in many implementations).
 * Runs once per process — subsequent calls are no-ops.
 */
async function ensureBucketExists() {
  if (bucketEnsured) return;

  const s3 = getS3Client();
  const bucket = getEnv().S3_BUCKET || "news-images";

  try {
    await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  } catch (err) {
    const status = err.$metadata?.httpStatusCode;
    if (status === 404) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createErr) {
        console.warn(
          `[s3] Não foi possível criar o bucket "${bucket}": ${createErr.message}`
        );
      }
    } else {
      console.warn(
        `[s3] Erro ao verificar bucket "${bucket}" (HTTP ${status}): ${err.message}`
      );
    }
  }

  bucketEnsured = true;
}

function getS3Bucket() {
  return getEnv().S3_BUCKET || "news-images";
}

function getS3PublicUrl() {
  return getEnv().S3_PUBLIC_URL?.replace(/\/+$/, "");
}

/**
 * Upload a file to S3
 * @param {string} key - Object key (e.g. "filename.jpg")
 * @param {Buffer} buffer - File content
 * @param {string} contentType - MIME type
 * @returns {Promise<void>}
 */
export async function uploadToS3(key, buffer, contentType) {
  await ensureBucketExists();
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

/**
 * Delete a file from S3 (best effort)
 * @param {string} key - Object key
 * @returns {Promise<void>}
 */
export async function deleteFromS3(key) {
  if (!key) return;
  try {
    const s3 = getS3Client();
    await s3.send(
      new DeleteObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    );
  } catch {
    // Best effort — ignore errors on delete
  }
}

/**
 * Build the public URL for an object
 * @param {string} key - Object key
 * @returns {string}
 */
export function getPublicUrl(key) {
  const publicUrl = getS3PublicUrl();
  if (!publicUrl) {
    throw new Error("S3_PUBLIC_URL não configurado.");
  }
  return `${publicUrl}/${key}`;
}

/**
 * Extract the object key from a stored image URL
 * @param {string} imageUrl - The URL stored in the database
 * @returns {string|null} - The object key, or null if not an S3 URL
 */
export function extractKeyFromUrl(imageUrl) {
  const publicUrl = getS3PublicUrl();
  if (!imageUrl || !publicUrl) return null;
  const prefix = publicUrl + "/";
  if (!imageUrl.startsWith(prefix)) return null;
  return imageUrl.slice(prefix.length);
}

/**
 * Checa se um objeto existe no bucket.
 * @param {string} key - Chave do objeto
 * @returns {Promise<boolean>}
 */
export async function objectExistsInS3(key) {
  if (!key) return false;

  try {
    const s3 = getS3Client();
    await s3.send(
      new HeadObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    );
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") {
      return false;
    }
    throw err; // Lança novamente se for erro de conexão/credencial
  }
}