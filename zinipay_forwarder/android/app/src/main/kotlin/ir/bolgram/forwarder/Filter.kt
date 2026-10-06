package ir.bolgram.forwarder

/** Decides which SMS may leave the phone: only bank senders, and never OTP / password messages. */
object Filter {
    private fun normText(s: String): String {
        val sb = StringBuilder()
        for (ch in s) {
            when (ch) {
                'ي' -> sb.append('ی')
                'ك' -> sb.append('ک')
                '‌', '‏', '‎' -> {}
                in '۰'..'۹' -> sb.append('0' + (ch - '۰'))
                in '٠'..'٩' -> sb.append('0' + (ch - '٠'))
                else -> sb.append(ch)
            }
        }
        return sb.toString().lowercase()
    }

    fun senderKey(s: String): String {
        val k = s.uppercase().replace(Regex("[^A-Z0-9]"), "")
        return k.replace(Regex("^(0098|98)(?=\\d{5,})"), "")
    }

    fun isBankSender(sender: String, trusted: List<String>): Boolean {
        val k = senderKey(sender)
        if (k.isEmpty()) return false
        for (t in trusted) {
            val tk = senderKey(t)
            if (tk.isEmpty()) continue
            if (k == tk) return true
            if (tk.length >= 5 && tk.all { it.isDigit() } && k.endsWith(tk)) return true
        }
        return false
    }

    private val SENSITIVE = listOf(
        "رمز", "پویا", "یکبارمصرف", "یکبار", "otp", "password", "passcode", "cvv", "پین", "pin2", "کدتایید", "کدتاییدیه",
        "کدفعالسازی", "کدورود", "کدامنیتی", "کداحراز", "کدرمز", "verificationcode", "کدشما", "کدیکبار"
    )

    /** True for one-time passwords, dynamic passwords and anything that looks like a secret. */
    fun isSensitive(body: String): Boolean {
        val n = normText(body)
        val compact = n.replace(Regex("\\s+"), "")
        if (SENSITIVE.any { compact.contains(it) }) return true
        return Regex("(^|[^a-z])pin([^a-z]|$)").containsMatchIn(n)
    }

    fun shouldForward(sender: String, body: String, trusted: List<String>): Boolean =
        body.isNotBlank() && isBankSender(sender, trusted) && !isSensitive(body)
}
