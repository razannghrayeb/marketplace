-- Migration: 005_labeling_system.sql
-- Data labeling and active learning tables

-- Label queue for active learning
CREATE TABLE IF NOT EXISTS label_queue (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL,  -- 'wardrobe', 'product', 'uploaded'
    source_id INTEGER NOT NULL,
    image_url TEXT,
    image_cdn TEXT,
    r2_key TEXT,
    task_type VARCHAR(30) NOT NULL,    -- 'category', 'color', 'pattern', 'material', 'attribute'
    predicted_label TEXT,
    predicted_confidence REAL,
    assigned_to INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'assigned', 'completed', 'skipped'
    priority INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(source_type, source_id, task_type)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_label_queue_status ON label_queue(status);
CREATE INDEX IF NOT EXISTS idx_label_queue_priority ON label_queue(priority DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_label_queue_assigned ON label_queue(assigned_to) WHERE status = 'assigned';

-- Labels submitted by labelers
CREATE TABLE IF NOT EXISTS labels (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES label_queue(id),
    labeler_id INTEGER NOT NULL REFERENCES users(id),
    label_value JSONB NOT NULL,
    confidence REAL,
    time_spent_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labels_task ON labels(task_id);
CREATE INDEX IF NOT EXISTS idx_labels_labeler ON labels(labeler_id);

-- Model training runs for tracking when retraining occurred
CREATE TABLE IF NOT EXISTS model_training_runs (
    id SERIAL PRIMARY KEY,
    model_version VARCHAR(50) NOT NULL,
    metrics JSONB,
    labels_used INTEGER,
    trained_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labeler statistics (for gamification / quality tracking)
CREATE TABLE IF NOT EXISTS labeler_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    labels_completed INTEGER DEFAULT 0,
    avg_time_ms REAL,
    accuracy_score REAL,
    last_active TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to update labeler stats on new label
CREATE OR REPLACE FUNCTION update_labeler_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO labeler_stats (user_id, labels_completed, avg_time_ms, last_active)
    VALUES (NEW.labeler_id, 1, NEW.time_spent_ms, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        labels_completed = labeler_stats.labels_completed + 1,
        avg_time_ms = (labeler_stats.avg_time_ms * labeler_stats.labels_completed + COALESCE(NEW.time_spent_ms, 0)) 
                      / (labeler_stats.labels_completed + 1),
        last_active = NOW(),
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_labeler_stats ON labels;
CREATE TRIGGER trigger_update_labeler_stats
    AFTER INSERT ON labels
    FOR EACH ROW
    EXECUTE FUNCTION update_labeler_stats();
