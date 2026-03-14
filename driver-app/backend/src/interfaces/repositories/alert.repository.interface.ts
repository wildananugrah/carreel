import type { Alert, AlertType } from "../../generated/prisma";

export interface CreateAlertDTO {
  inspectionId: string;
  alertType: AlertType;
  message: string;
}

export interface IAlertRepository {
  create(data: CreateAlertDTO): Promise<Alert>;
}
