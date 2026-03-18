// Upstash REST API usage placeholder
import { config } from "../../config";

// Example: fetch/axios for Upstash REST API
import axios from "axios";

export async function upstashGet(key: string) {
  const url = `${config.redis.restUrl}/get/${key}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.redis.restToken}`,
    },
  });
  return res.data;
}

export async function upstashSet(key: string, value: string) {
  const url = `${config.redis.restUrl}/set/${key}/${value}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.redis.restToken}`,
    },
  });
  return res.data;
}

