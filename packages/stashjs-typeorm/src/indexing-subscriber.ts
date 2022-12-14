import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
  SoftRemoveEvent,
  RecoverEvent,
  Logger,
} from "typeorm"
import { deleteEntity, ensureStashID, mapAndPutEntity } from "./collection-adapter"
import { isStashed, StashLinkableEntity, StashLinkedEntity } from "./types"

type StashSyncEvent = "insert" | "update" | "remove"

function logStashEvent(logger: Logger, event: StashSyncEvent, stashId: string): string {
  logger.log("info", `Stash[${event}]: ID ${stashId}`)
  return stashId
}

@EventSubscriber()
export class IndexingSubscriber implements EntitySubscriberInterface {
  /* Ensure stashID is set on insertion */
  beforeInsert({ entity }: InsertEvent<StashLinkableEntity>): void {
    ensureStashID(entity)
  }

  /* Ensure stashID is set on recovered records */
  beforeRecover({ entity }: RecoverEvent<StashLinkableEntity>): void {
    ensureStashID(entity)
  }

  /* Ensure stashID is set on update */
  beforeUpdate({ entity }: UpdateEvent<StashLinkableEntity>): void {
    ensureStashID(entity as StashLinkableEntity)
  }

  /* Sync to collection after insert */
  async afterInsert({ connection, entity, metadata }: InsertEvent<StashLinkedEntity>): Promise<string> {
    return await mapAndPutEntity(entity, metadata.tablePath).then(stashId =>
      logStashEvent(connection.logger, "insert", stashId)
    )
  }

  /* Sync to collection after update */
  async afterUpdate({ connection, entity, metadata }: UpdateEvent<StashLinkedEntity>): Promise<string> {
    return await mapAndPutEntity(entity as StashLinkedEntity, metadata.tablePath).then(stashId =>
      logStashEvent(connection.logger, "update", stashId)
    )
  }

  /* Remove from collection after DB removal */
  async afterRemove({ databaseEntity, connection, metadata }: RemoveEvent<StashLinkableEntity>): Promise<string> {
    if (databaseEntity && isStashed(databaseEntity)) {
      return await deleteEntity(databaseEntity, metadata.tableName).then(stashId =>
        logStashEvent(connection.logger, "remove", stashId)
      )
    }
  }

  /* Remove from collection after DB soft removal */
  async afterSoftRemove({
    databaseEntity,
    connection,
    metadata,
  }: SoftRemoveEvent<StashLinkableEntity>): Promise<string> {
    if (isStashed(databaseEntity)) {
      return await deleteEntity(databaseEntity, metadata.tableName).then(stashId =>
        logStashEvent(connection.logger, "remove", stashId)
      )
    }
  }

  /* Sync to collection after recovery */
  async afterRecover({ connection, entity, metadata }: RecoverEvent<StashLinkedEntity>): Promise<string> {
    return await mapAndPutEntity(entity, metadata.tablePath).then(stashId =>
      logStashEvent(connection.logger, "update", stashId)
    )
  }
}
