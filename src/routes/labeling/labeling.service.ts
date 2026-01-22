/**
 * Labeling Service
 * Business logic for active learning, label queue management and reference data.
 */
import { pg } from "../../lib/core";

// ============================================================================
// Types
// ============================================================================

export interface LabelTask {
  id: number;
  image_url: string;
  image_cdn?: string;
  r2_key?: string;
  source_type: "wardrobe" | "product" | "uploaded";
  source_id: number;
  task_type: "category" | "color" | "pattern" | "material" | "attribute";
  predicted_label?: string;
  predicted_confidence?: number;
  assigned_to?: number;
  status: "pending" | "assigned" | "completed" | "skipped";
  priority: number;
  created_at: Date;
  completed_at?: Date;
}

export interface LabelSubmission {
  task_id: number;
  labeler_id: number;
  label_value: string | Record<string, any>;
  confidence?: number;
  time_spent_ms?: number;
}

export interface ActiveLearningConfig {
  uncertaintyThreshold: number;  // Below this confidence, queue for labeling
  batchSize: number;
  priorityWeights: {
    uncertainty: number;
    recency: number;
    diversity: number;
  };
}

const DEFAULT_CONFIG: ActiveLearningConfig = {
  uncertaintyThreshold: 0.7,
  batchSize: 50,
  priorityWeights: {
    uncertainty: 0.5,
    recency: 0.3,
    diversity: 0.2,
  },
};

// ============================================================================
// Label Queue Management
// ============================================================================

/**
 * Queue items with low confidence predictions for human labeling
 */
export async function queueUncertainItems(
  config: Partial<ActiveLearningConfig> = {}
): Promise<number> {
  const { uncertaintyThreshold, batchSize } = { ...DEFAULT_CONFIG, ...config };

  // Find wardrobe items with low extraction confidence
  const result = await pg.query(
    `INSERT INTO label_queue (source_type, source_id, image_url, image_cdn, r2_key, task_type, predicted_label, predicted_confidence, priority, status)
     SELECT 
       'wardrobe',
       wi.id,
       wi.image_url,
       wi.image_cdn,
       wi.r2_key,
       'category',
       c.name,
       wi.extraction_confidence,
       CASE 
         WHEN wi.extraction_confidence IS NULL THEN 100
         ELSE ROUND((1 - wi.extraction_confidence) * 100)
       END as priority,
       'pending'
     FROM wardrobe_items wi
     LEFT JOIN categories c ON wi.category_id = c.id
     WHERE wi.attributes_extracted = true
       AND (wi.extraction_confidence < $1 OR wi.extraction_confidence IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM label_queue lq 
         WHERE lq.source_type = 'wardrobe' 
           AND lq.source_id = wi.id 
           AND lq.task_type = 'category'
           AND lq.status IN ('pending', 'assigned')
       )
     ORDER BY priority DESC
     LIMIT $2
     ON CONFLICT DO NOTHING`,
    [uncertaintyThreshold, batchSize]
  );

  return result.rowCount ?? 0;
}

/**
 * Get pending label tasks for a labeler
 */
export async function getPendingTasks(
  labelerId: number,
  limit: number = 10,
  taskType?: string
): Promise<LabelTask[]> {
  let query = `
    SELECT * FROM label_queue 
    WHERE status = 'pending'
  `;
  const params: any[] = [];

  if (taskType) {
    params.push(taskType);
    query += ` AND task_type = $${params.length}`;
  }

  query += ` ORDER BY priority DESC, created_at ASC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pg.query<LabelTask>(query, params);
  return result.rows;
}

/**
 * Assign a task to a labeler
 */
export async function assignTask(taskId: number, labelerId: number): Promise<LabelTask | null> {
  const result = await pg.query<LabelTask>(
    `UPDATE label_queue 
     SET status = 'assigned', assigned_to = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [taskId, labelerId]
  );
  return result.rows[0] || null;
}

/**
 * Submit a label for a task
 */
export async function submitLabel(submission: LabelSubmission): Promise<boolean> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // Update label queue
    await client.query(
      `UPDATE label_queue 
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [submission.task_id]
    );

    // Store the label
    await client.query(
      `INSERT INTO labels (task_id, labeler_id, label_value, confidence, time_spent_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        submission.task_id,
        submission.labeler_id,
        JSON.stringify(submission.label_value),
        submission.confidence,
        submission.time_spent_ms,
      ]
    );

    // Get task details to update source
    const taskResult = await client.query<LabelTask>(
      `SELECT * FROM label_queue WHERE id = $1`,
      [submission.task_id]
    );
    const task = taskResult.rows[0];

    if (task) {
      // Update the source item with the new label
      if (task.source_type === "wardrobe" && task.task_type === "category") {
        // Look up category ID from label value
        const categoryResult = await client.query(
          `SELECT id FROM categories WHERE name = $1`,
          [submission.label_value]
        );
        if (categoryResult.rows[0]) {
          await client.query(
            `UPDATE wardrobe_items SET category_id = $1 WHERE id = $2`,
            [categoryResult.rows[0].id, task.source_id]
          );
        }
      }
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Skip a task (mark as skipped)
 */
export async function skipTask(taskId: number, reason?: string): Promise<boolean> {
  const result = await pg.query(
    `UPDATE label_queue SET status = 'skipped' WHERE id = $1`,
    [taskId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Active Learning Metrics
// ============================================================================

/**
 * Get labeling statistics
 */
export async function getLabelingStats(): Promise<{
  pending: number;
  assigned: number;
  completed: number;
  skipped: number;
  avgTimeMs: number;
  byTaskType: Record<string, number>;
}> {
  const countResult = await pg.query(`
    SELECT status, COUNT(*) as count 
    FROM label_queue 
    GROUP BY status
  `);

  const avgTimeResult = await pg.query(`
    SELECT AVG(time_spent_ms) as avg_time FROM labels
  `);

  const byTypeResult = await pg.query(`
    SELECT task_type, COUNT(*) as count 
    FROM label_queue 
    WHERE status = 'pending'
    GROUP BY task_type
  `);

  const counts: Record<string, number> = {};
  for (const row of countResult.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  const byTaskType: Record<string, number> = {};
  for (const row of byTypeResult.rows) {
    byTaskType[row.task_type] = parseInt(row.count, 10);
  }

  return {
    pending: counts["pending"] || 0,
    assigned: counts["assigned"] || 0,
    completed: counts["completed"] || 0,
    skipped: counts["skipped"] || 0,
    avgTimeMs: parseFloat(avgTimeResult.rows[0]?.avg_time) || 0,
    byTaskType,
  };
}

/**
 * Check if model retraining should be triggered
 */
export async function shouldTriggerRetraining(minLabels: number = 100): Promise<boolean> {
  const result = await pg.query(`
    SELECT COUNT(*) as count FROM labels 
    WHERE created_at > (
      SELECT COALESCE(MAX(trained_at), '1970-01-01') FROM model_training_runs
    )
  `);
  return parseInt(result.rows[0]?.count, 10) >= minLabels;
}

/**
 * Record a model training run
 */
export async function recordTrainingRun(
  modelVersion: string,
  metrics: Record<string, number>
): Promise<void> {
  await pg.query(
    `INSERT INTO model_training_runs (model_version, metrics, trained_at)
     VALUES ($1, $2, NOW())`,
    [modelVersion, JSON.stringify(metrics)]
  );
}

// ============================================================================
// Reference Data Functions
// ============================================================================

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface Pattern {
  id: number;
  name: string;
}

export interface Material {
  id: number;
  name: string;
}

/**
 * Get all categories for labeling
 */
export async function getCategories(): Promise<Category[]> {
  const result = await pg.query<Category>(
    `SELECT id, name, parent_id FROM categories ORDER BY name`
  );
  return result.rows;
}

/**
 * Get all patterns for labeling
 */
export async function getPatterns(): Promise<Pattern[]> {
  const result = await pg.query<Pattern>(
    `SELECT id, name FROM patterns ORDER BY name`
  );
  return result.rows;
}

/**
 * Get all materials for labeling
 */
export async function getMaterials(): Promise<Material[]> {
  const result = await pg.query<Material>(
    `SELECT id, name FROM materials ORDER BY name`
  );
  return result.rows;
}
