package com.ooro.screenplayer.data

import android.content.Context
import androidx.room.*

@Entity(tableName = "campaign_manifest") data class ManifestEntity(@PrimaryKey val id: String = "active", val version: Long, val timezone: String, val validUntil: String?, val json: String, val authorizationReceivedElapsedMillis: Long? = null, val authorizationBootCount: Int? = null, val authorizationDurationMillis: Long? = null, val authorizationScreenId: String? = null, val authorizationServerTimeUtcMillis: Long? = null)
@Entity(tableName = "proof_of_play") data class ProofEntity(@PrimaryKey val eventId: String, val payload: String, val synced: Boolean = false, val createdAt: Long = System.currentTimeMillis(), @ColumnInfo(defaultValue = "0") val quarantined: Boolean = false)
@Entity(tableName = "app_error") data class ErrorEntity(@PrimaryKey(autoGenerate = true) val id: Long = 0, val message: String, val createdAt: Long = System.currentTimeMillis())
@Entity(tableName = "delivery_quota") data class DeliveryQuotaEntity(@PrimaryKey val grantId: String, val campaignId: String, val revision: Int, val remainingPlays: Int?, val unlimited: Boolean)
@Entity(tableName = "quota_consumption", indices = [Index(value = ["grantId", "revision"])]) data class QuotaConsumptionEntity(@PrimaryKey val eventId: String, val grantId: String, val revision: Int, val consumedAt: Long = System.currentTimeMillis())

@Dao interface ManifestDao {
    @Query("SELECT * FROM campaign_manifest WHERE id = 'active' LIMIT 1") suspend fun active(): ManifestEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(entity: ManifestEntity)
    /** Revoke identity-bound authorization while preserving the cached manifest and assets. */
    @Query("UPDATE campaign_manifest SET authorizationReceivedElapsedMillis = NULL, authorizationBootCount = NULL, authorizationDurationMillis = NULL, authorizationScreenId = NULL, authorizationServerTimeUtcMillis = NULL WHERE id = 'active'")
    suspend fun invalidateAuthorization()
}
@Dao interface ProofDao { @Query("SELECT * FROM proof_of_play WHERE synced = 0 AND quarantined = 0 ORDER BY createdAt LIMIT :limit") suspend fun pending(limit: Int): List<ProofEntity>; @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun add(entity: ProofEntity); @Query("DELETE FROM proof_of_play WHERE eventId IN (:ids)") suspend fun delete(ids: List<String>); @Query("UPDATE proof_of_play SET quarantined = 1 WHERE eventId IN (:ids)") suspend fun quarantine(ids: List<String>); @Query("SELECT * FROM proof_of_play ORDER BY createdAt") suspend fun history(): List<ProofEntity>; @Query("SELECT COUNT(*) FROM proof_of_play WHERE synced = 0 AND quarantined = 0") suspend fun pendingCount(): Int }
@Dao interface ErrorDao {
    @Insert suspend fun add(entity: ErrorEntity)
    @Query("SELECT message FROM app_error ORDER BY createdAt DESC LIMIT :limit") suspend fun recent(limit: Int): List<String>
    @Query("DELETE FROM app_error WHERE id NOT IN (SELECT id FROM app_error ORDER BY createdAt DESC LIMIT 20)") suspend fun prune()
}
@Dao interface DeliveryQuotaDao {
    @Query("SELECT * FROM delivery_quota WHERE grantId = :grantId LIMIT 1") suspend fun find(grantId: String): DeliveryQuotaEntity?
    @Query("SELECT * FROM delivery_quota") suspend fun all(): List<DeliveryQuotaEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(entity: DeliveryQuotaEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun receipt(entity: QuotaConsumptionEntity): Long
    @Query("DELETE FROM quota_consumption WHERE eventId = :eventId") suspend fun deleteReceipt(eventId: String)
    @Query("SELECT eventId FROM quota_consumption WHERE eventId = :eventId LIMIT 1") suspend fun hasReceipt(eventId: String): String?
    @Query("SELECT COUNT(*) FROM quota_consumption WHERE grantId = :grantId") suspend fun pendingConsumptions(grantId: String): Int
    @Query("DELETE FROM quota_consumption WHERE eventId IN (:eventIds)") suspend fun acknowledgeConsumptions(eventIds: List<String>)
    @Query("UPDATE delivery_quota SET remainingPlays = :remaining WHERE grantId = :grantId AND revision = :revision") suspend fun setRemaining(grantId: String, revision: Int, remaining: Int)
    @Query("UPDATE delivery_quota SET remainingPlays = remainingPlays - 1 WHERE grantId = :grantId AND revision = :revision AND unlimited = 0 AND remainingPlays > 0") suspend fun decrement(grantId: String, revision: Int): Int
    @Transaction suspend fun mergeIncoming(incoming: DeliveryQuotaEntity) {
        val old = find(incoming.grantId)
        if (old == null) put(incoming)
        else {
            // Same-revision responses can be stale, so never restore consumed
            // plays. A newer grant can add authorization, but locally consumed
            // plays whose proofs are still unacknowledged remain reserved.
            val newerGrant = incoming.revision > old.revision
            val mergedUnlimited = if (newerGrant) incoming.unlimited else old.unlimited && incoming.unlimited
            val remaining = if (newerGrant) {
                incoming.remainingPlays?.minus(pendingConsumptions(incoming.grantId))?.coerceAtLeast(0)
            } else when {
                old.unlimited && incoming.unlimited -> null
                old.unlimited -> incoming.remainingPlays
                incoming.unlimited -> old.remainingPlays
                else -> minOf(old.remainingPlays ?: 0, incoming.remainingPlays ?: 0)
            }
            put(incoming.copy(remainingPlays = remaining, unlimited = mergedUnlimited))
        }
    }
    @Transaction suspend fun consumeOnce(grantId: String, revision: Int, eventId: String): Boolean {
        val quota = find(grantId)?.takeIf { it.revision == revision } ?: return false
        if (receipt(QuotaConsumptionEntity(eventId, grantId, revision)) == -1L) return true
        if (!quota.unlimited && decrement(grantId, revision) != 1) { deleteReceipt(eventId); return false }
        return true
    }
}

internal fun ensureDeliveryQuotaTables(db: androidx.sqlite.db.SupportSQLiteDatabase) {
    db.execSQL("CREATE TABLE IF NOT EXISTS delivery_quota (grantId TEXT NOT NULL PRIMARY KEY, campaignId TEXT NOT NULL, revision INTEGER NOT NULL, remainingPlays INTEGER, unlimited INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE IF NOT EXISTS quota_consumption (eventId TEXT NOT NULL PRIMARY KEY, grantId TEXT NOT NULL, revision INTEGER NOT NULL, consumedAt INTEGER NOT NULL)")
    db.execSQL("CREATE INDEX IF NOT EXISTS index_quota_consumption_grantId_revision ON quota_consumption (grantId, revision)")
}

@Database(entities = [ManifestEntity::class, ProofEntity::class, ErrorEntity::class, DeliveryQuotaEntity::class, QuotaConsumptionEntity::class], version = 5, exportSchema = false)
abstract class OoroDatabase : RoomDatabase() { abstract fun manifestDao(): ManifestDao; abstract fun proofDao(): ProofDao; abstract fun errorDao(): ErrorDao; abstract fun deliveryQuotaDao(): DeliveryQuotaDao
    companion object {
        internal val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) = ensureDeliveryQuotaTables(db)
        }
        internal val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE campaign_manifest ADD COLUMN authorizationReceivedElapsedMillis INTEGER")
                db.execSQL("ALTER TABLE campaign_manifest ADD COLUMN authorizationBootCount INTEGER")
                db.execSQL("ALTER TABLE campaign_manifest ADD COLUMN authorizationDurationMillis INTEGER")
                db.execSQL("ALTER TABLE campaign_manifest ADD COLUMN authorizationScreenId TEXT")
                // Some version-2 screen databases were created before quota tables
                // were materialized. Repair them idempotently without discarding
                // their manifest, cached assets, pairing, or proof history.
                ensureDeliveryQuotaTables(db)
            }
        }
        internal val MIGRATION_3_4 = object : androidx.room.migration.Migration(3, 4) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE campaign_manifest ADD COLUMN authorizationServerTimeUtcMillis INTEGER")
            }
        }
        internal val MIGRATION_4_5 = object : androidx.room.migration.Migration(4, 5) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE proof_of_play ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0")
            }
        }
        @Volatile private var instance: OoroDatabase? = null
        fun get(context: Context) = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context, OoroDatabase::class.java, "ooro.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5).build().also { instance = it }
        }
    }
}
