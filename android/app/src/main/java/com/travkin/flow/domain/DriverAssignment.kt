package com.travkin.flow.domain

data class DriverAssignment(val companyId: String, val vehicleId: String, val vehicleName: String, val plate: String?,
    val assignmentId: String?, val driverPersonId: String?, val driverName: String?, val canEdit: Boolean, val drivers: List<CatalogOption>)
