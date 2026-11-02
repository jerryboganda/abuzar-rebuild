SET search_path TO dbo, public;

-- ==== trigger Trig_EMP_Payroll_AfterUpdate_Paid ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_emp_payroll_afterupdate_paid()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_emp_payroll_afterupdate_paid', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_emp_payroll_afterupdate_paid', '1', true);
  IF TRUE THEN
    UPDATE dbo.emp_attendance SET payed = 'Y' FROM deleted AS u WHERE ((emp_attendance.empcode = u.empcode) AND (emp_attendance.timein BETWEEN u.fromdate AND u.todate));
  END IF;
  PERFORM set_config('tsql.trig_emp_payroll_afterupdate_paid', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_emp_payroll_afterupdate_paid ON dbo.emp_payroll;
CREATE TRIGGER trig_emp_payroll_afterupdate_paid AFTER UPDATE OF paid ON dbo.emp_payroll
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_emp_payroll_afterupdate_paid();

-- ==== trigger Trig_GodownDetail_AfterUpdate_LastUpdated ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_godowndetail_afterupdate_lastupdated()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_godowndetail_afterupdate_lastupdated', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_godowndetail_afterupdate_lastupdated', '1', true);
  UPDATE dbo.godowndetail SET lastupdated = localtimestamp(3) FROM deleted AS u, dbo.godowndetail AS g WHERE ((((u.gcode = g.gcode) AND (u.icode = g.icode)) AND (u.batch = g.batch)) AND (u.expiry = g.expiry));
  PERFORM set_config('tsql.trig_godowndetail_afterupdate_lastupdated', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_godowndetail_afterupdate_lastupdated ON dbo.godowndetail;
CREATE TRIGGER trig_godowndetail_afterupdate_lastupdated AFTER UPDATE ON dbo.godowndetail
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_godowndetail_afterupdate_lastupdated();

-- ==== trigger Trig_Item_AfterUpdate_UpdateLastUpdate_TimeStamp ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_item_afterupdate_updatelastupdate_timestamp()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_item_afterupdate_updatelastupdate_timestamp', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_item_afterupdate_updatelastupdate_timestamp', '1', true);
  UPDATE dbo.item SET lastupdate = localtimestamp(3) FROM deleted AS u, dbo.item AS i WHERE (u.icode = i.icode);
  PERFORM set_config('tsql.trig_item_afterupdate_updatelastupdate_timestamp', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_item_afterupdate_updatelastupdate_timestamp ON dbo.item;
CREATE TRIGGER trig_item_afterupdate_updatelastupdate_timestamp AFTER UPDATE ON dbo.item
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_item_afterupdate_updatelastupdate_timestamp();

-- ==== trigger Trig_ItemPart_AfterUpdate_ReflectItemPartChanges_TO_Item ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_itempart_afterupdate_reflectitempartchanges_to_item()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_itempart_afterupdate_reflectitempartchanges_to_ite', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_itempart_afterupdate_reflectitempartchanges_to_ite', '1', true);
  IF ((((TRUE OR TRUE) OR TRUE) OR TRUE) OR TRUE) THEN
    IF ((SELECT masteripartcode FROM inserted) IS NULL) THEN
      UPDATE dbo.item AS item SET remarks = coalesce((SELECT inserted.description FROM inserted), ''), packingdesc = coalesce((SELECT inserted.application FROM inserted), ''), remarks1 = coalesce((SELECT inserted.remarks FROM inserted), ''), icatcode = (SELECT inserted.icatcode FROM inserted), iccode = (SELECT inserted.iccode FROM inserted) FROM dbo.itempart WHERE ((item.ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT i.ipartcode FROM inserted AS i)) UNION SELECT inserted.ipartcode FROM inserted)) AND (itempart.ipartcode = item.ipartcode));
      UPDATE dbo.itempart AS itempart SET description = i.description, application = i.application, remarks = i.remarks, icatcode = i.icatcode, iccode = i.iccode FROM inserted AS i WHERE (itempart.masteripartcode = i.ipartcode);
    END IF;
  END IF;
  PERFORM set_config('tsql.trig_itempart_afterupdate_reflectitempartchanges_to_ite', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_itempart_afterupdate_reflectitempartchanges_to_item ON dbo.itempart;
CREATE TRIGGER trig_itempart_afterupdate_reflectitempartchanges_to_item AFTER UPDATE OF description, application, remarks, icatcode, iccode ON dbo.itempart
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_itempart_afterupdate_reflectitempartchanges_to_item();

-- ==== trigger Trig_ItemPartInModel_AfterDelete_ReflectItemPartInModelChanges_TO_ItemInModel ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_itempartinmodel_afterdelete_reflectitempartin_1b1b6e08()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_itempartinmodel_afterdelete_reflectitemparti_86e4d', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_itempartinmodel_afterdelete_reflectitemparti_86e4d', '1', true);
  IF ((SELECT max(masteripartcode) FROM dbo.itempart WHERE (ipartcode IN (SELECT DISTINCT deleted.ipartcode FROM deleted))) IS NULL) THEN
    DELETE FROM dbo.iteminmodel WHERE (icode IN (SELECT item.icode FROM dbo.item WHERE (item.ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT d.ipartcode FROM deleted AS d)) UNION SELECT DISTINCT deleted.ipartcode FROM deleted))));
    DELETE FROM dbo.itempartinmodel WHERE (ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT d.ipartcode FROM deleted AS d))));
  END IF;
  PERFORM set_config('tsql.trig_itempartinmodel_afterdelete_reflectitemparti_86e4d', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_itempartinmodel_afterdelete_reflectitempartinmode_600411f9 ON dbo.itempartinmodel;
CREATE TRIGGER trig_itempartinmodel_afterdelete_reflectitempartinmode_600411f9 AFTER DELETE ON dbo.itempartinmodel
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_itempartinmodel_afterdelete_reflectitempartin_1b1b6e08();

-- ==== trigger Trig_ItemPartInModel_AfterInsertUpdate_ReflectItemPartInModelChanges_TO_ItemInModel ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_itempartinmodel_afterinsertupdate_reflectitem_df3a4d42()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_itempartinmodel_afterinsertupdate_reflectite_13384', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_itempartinmodel_afterinsertupdate_reflectite_13384', '1', true);
  IF ((SELECT max(masteripartcode) FROM dbo.itempart WHERE (ipartcode IN (SELECT DISTINCT inserted.ipartcode FROM inserted))) IS NULL) THEN
    DELETE FROM dbo.iteminmodel WHERE (icode IN (SELECT item.icode FROM dbo.item WHERE (item.ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT i.ipartcode FROM inserted AS i)) UNION SELECT DISTINCT inserted.ipartcode FROM inserted))));
    INSERT INTO dbo.iteminmodel (icode, modelcode) SELECT i.icode, m.modelcode FROM (SELECT item.icode FROM dbo.item WHERE (item.ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT i.ipartcode FROM inserted AS i)) UNION SELECT DISTINCT inserted.ipartcode FROM inserted))) AS i, (SELECT DISTINCT modelcode FROM dbo.itempartinmodel WHERE (ipartcode IN (SELECT DISTINCT inserted.ipartcode FROM inserted))) AS m;
    DELETE FROM dbo.itempartinmodel WHERE (ipartcode IN (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT i.ipartcode FROM inserted AS i))));
    INSERT INTO dbo.itempartinmodel (ipartcode, modelcode) SELECT ip.ipartcode, m.modelcode FROM (SELECT ip.ipartcode FROM dbo.itempart AS ip WHERE (ip.masteripartcode IN (SELECT DISTINCT i.ipartcode FROM inserted AS i))) AS ip, (SELECT modelcode FROM dbo.itempartinmodel WHERE (ipartcode IN (SELECT DISTINCT inserted.ipartcode FROM inserted))) AS m;
  END IF;
  PERFORM set_config('tsql.trig_itempartinmodel_afterinsertupdate_reflectite_13384', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_itempartinmodel_afterinsertupdate_reflectitempart_b44c6f5f ON dbo.itempartinmodel;
CREATE TRIGGER trig_itempartinmodel_afterinsertupdate_reflectitempart_b44c6f5f AFTER INSERT ON dbo.itempartinmodel
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_itempartinmodel_afterinsertupdate_reflectitem_df3a4d42();
DROP TRIGGER IF EXISTS trig_itempartinmodel_afterinsertupdate_reflectitempart_59d20945 ON dbo.itempartinmodel;
CREATE TRIGGER trig_itempartinmodel_afterinsertupdate_reflectitempart_59d20945 AFTER UPDATE ON dbo.itempartinmodel
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_itempartinmodel_afterinsertupdate_reflectitem_df3a4d42();

-- ==== trigger Trig_Patient_AfterUpdate_InActiveCount ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_patient_afterupdate_inactivecount()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_patient_afterupdate_inactivecount', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_patient_afterupdate_inactivecount', '1', true);
  IF TRUE THEN
    IF ((SELECT max(active) FROM inserted) = 'N') THEN
      UPDATE dbo.patient AS patient SET inactivecount = coalesce((inserted.inactivecount + 1), 0) FROM inserted WHERE (patient.patientcode = inserted.patientcode);
    END IF;
  END IF;
  PERFORM set_config('tsql.trig_patient_afterupdate_inactivecount', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_patient_afterupdate_inactivecount ON dbo.patient;
CREATE TRIGGER trig_patient_afterupdate_inactivecount AFTER UPDATE OF active ON dbo.patient
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_patient_afterupdate_inactivecount();

-- ==== trigger Trig_PurLedger_AfterUpdate_UpdatePOStatistics_For_Purchases ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_purledger_afterupdate_updatepostatistics_for_purchases()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_purledger_afterupdate_updatepostatistics_for_8c990', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_purledger_afterupdate_updatepostatistics_for_8c990', '1', true);
  UPDATE dbo.purorderheader SET listofpurinvoices = left((((((coalesce(purorderheader.listofpurinvoices, '') || '(') || (purledger.purinvcode)::text) || ',') || (purledger.invtotal)::text) || ') , '), 500), totalofpurchases = (purorderheader.totalofpurchases + purledger.invtotal) FROM inserted, dbo.purledger WHERE (((((inserted.purinvcode = purledger.purinvcode) AND (inserted.posted = 'Y')) AND (purledger.pocode > 0)) AND (inserted.pocode > 0)) AND (inserted.pocode = purorderheader.pocode));
  PERFORM set_config('tsql.trig_purledger_afterupdate_updatepostatistics_for_8c990', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_purledger_afterupdate_updatepostatistics_for_purchases ON dbo.purledger;
CREATE TRIGGER trig_purledger_afterupdate_updatepostatistics_for_purchases AFTER UPDATE ON dbo.purledger
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_purledger_afterupdate_updatepostatistics_for_purchases();

-- ==== trigger Trig_SrLedger_AfterInsert_UpdateTotalOfSaleReturnsInSaleLedger ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_srledger_afterinsert_updatetotalofsalereturns_ff34e65b()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
BEGIN
  IF coalesce(current_setting('tsql.trig_srledger_afterinsert_updatetotalofsalereturn_150f4', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_srledger_afterinsert_updatetotalofsalereturn_150f4', '1', true);
  UPDATE dbo.saleledger SET listofsrinvoices = (((((saleledger.listofsrinvoices || '(') || (inserted.srinvcode)::text) || ',') || (inserted.invtotal)::text) || ') , '), totalofsalereturns = (saleledger.totalofsalereturns + inserted.invtotal) FROM inserted WHERE (saleledger.saleinvcode = inserted.saleinvcode);
  PERFORM set_config('tsql.trig_srledger_afterinsert_updatetotalofsalereturn_150f4', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_srledger_afterinsert_updatetotalofsalereturnsinsaleledger ON dbo.srledger;
CREATE TRIGGER trig_srledger_afterinsert_updatetotalofsalereturnsinsaleledger AFTER INSERT ON dbo.srledger
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_srledger_afterinsert_updatetotalofsalereturns_ff34e65b();

-- ==== trigger Trig_UserGroups_After_Update_Delete ====
CREATE OR REPLACE FUNCTION dbo.trg_trig_usergroups_after_update_delete()
  RETURNS trigger
  LANGUAGE plpgsql AS $body$
#variable_conflict use_column
DECLARE
  v_logdate timestamp(3);
BEGIN
  IF coalesce(current_setting('tsql.trig_usergroups_after_update_delete', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM set_config('tsql.trig_usergroups_after_update_delete', '1', true);
  v_logdate := localtimestamp(3);
  INSERT INTO dbo.usergroupslog SELECT v_logdate, usercode, groupcode, modifiedby FROM deleted;
  IF (0 <> 0) THEN
    RAISE EXCEPTION 'Database Problem Occur in generating UserGroupsLog';
  END IF;
  PERFORM set_config('tsql.trig_usergroups_after_update_delete', '0', true);
  RETURN NULL;
END
$body$;
DROP TRIGGER IF EXISTS trig_usergroups_after_update_delete_u ON dbo.usergroups;
CREATE TRIGGER trig_usergroups_after_update_delete_u AFTER UPDATE ON dbo.usergroups
  REFERENCING OLD TABLE AS deleted NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_usergroups_after_update_delete();
DROP TRIGGER IF EXISTS trig_usergroups_after_update_delete_d ON dbo.usergroups;
CREATE TRIGGER trig_usergroups_after_update_delete_d AFTER DELETE ON dbo.usergroups
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION dbo.trg_trig_usergroups_after_update_delete();
