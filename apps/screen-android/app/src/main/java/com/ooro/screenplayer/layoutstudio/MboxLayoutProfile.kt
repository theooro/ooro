package com.ooro.screenplayer.layoutstudio

/** Candidate profile, not a publication certificate. The API must still enforce acceptance evidence. */
object MboxLayoutProfile {
    const val ID = "MBOX_ANDROID10_1280_720_V1"
    const val VERSION = 1
    const val HARDWARE = "sun50iw9p1"
    const val FIRMWARE_SHA256 = "10c10aab9b732bfa48740800d877da2a3bb27d9b141b70fffae9dbb946df5cab"
    fun fingerprintHash(value: String): String = java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    val candidateWidgets = setOf("IMAGE", "TEXT")

    fun matchesRuntime(contract: LayoutStudioContract, model: String, apiLevel: Int, abis: List<String>, width: Int, height: Int, hardware: String, firmwareHash: String): Boolean =
        contract.profileId != ID || (
            contract.capabilityProfileVersion == VERSION && model == "MBOX" && apiLevel == 29 &&
                "armeabi-v7a" in abis && width == 1280 && height == 720 && hardware == HARDWARE && firmwareHash == FIRMWARE_SHA256
            )
}
