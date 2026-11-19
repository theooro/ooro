package com.ooro.deviceagent.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class DeviceOsCommandParsingTest {
    @Test fun parsesApiCommandContract() {
        val command = parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"RESTART_APP","packageName":"com.ooro.screenplayer","payload":{"reason":"operator-request"},"expiresAt":"2026-11-18T14:00:00Z"}"""))
        assertEquals("c5af817a-84df-48f7-9eb9-63fb6813d4a6", command.id)
        assertEquals("RESTART_APP", command.commandType)
        assertEquals("com.ooro.screenplayer", command.packageName)
        assertEquals("operator-request", command.payload?.getString("reason"))
        assertEquals("2026-11-18T14:00:00Z", command.expiresAt)
    }

    @Test fun allowsNullablePayloadAndExpiryFromApi() {
        val command = parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"UNINSTALL_APP","packageName":"com.example.app","payload":null,"expiresAt":null}"""))
        assertNull(command.payload)
        assertNull(command.expiresAt)
    }

    @Test fun rejectsMalformedOrUnsupportedCommands() {
        assertRejected { parseDeviceOsCommand(JSONObject("""{"id":"bad","commandType":"RESTART_APP","packageName":"com.example.app"}""")) }
        assertRejected { parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"RUN_SHELL","packageName":"com.example.app"}""")) }
        assertRejected { parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"RESTART_APP","packageName":"../other"}""")) }
        assertRejected { parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"RESTART_APP","packageName":"com.example.app","expiresAt":"soon"}""")) }
        assertRejected { parseDeviceOsCommand(JSONObject("""{"id":"c5af817a-84df-48f7-9eb9-63fb6813d4a6","commandType":"RESTART_APP","packageName":"com.example.app","payload":[]}""")) }
    }

    private fun assertRejected(block: () -> Unit) {
        try { block(); fail("Expected malformed command to be rejected") }
        catch (_: IllegalArgumentException) { }
        catch (_: IllegalStateException) { }
    }
}
