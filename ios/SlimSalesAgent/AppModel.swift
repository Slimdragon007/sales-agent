import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    let workerBaseURL: URL

    private(set) var credentials: PreviewCredentials?
    private(set) var runtimeSafety: RuntimeSafety?
    private(set) var phonePilotCall: PhonePilotCall?
    private(set) var contacts: [PhoneContact] = []
    private(set) var recents: [PhoneRecent] = []
    private(set) var isRefreshing = false
    private(set) var isPhonePilotBusy = false
    var selectedContactId: String?
    var errorMessage: String?
    var phonePilotErrorMessage: String?

    @ObservationIgnored private let client: RuntimeSafetyClient
    @ObservationIgnored private let phonePilotClient: PhonePilotClient
    @ObservationIgnored private let credentialsStore: any CredentialsStoring

    init(
        workerBaseURL: URL,
        credentialsStore: any CredentialsStoring,
        client: RuntimeSafetyClient = RuntimeSafetyClient(),
        phonePilotClient: PhonePilotClient = PhonePilotClient()
    ) {
        self.workerBaseURL = workerBaseURL
        self.credentialsStore = credentialsStore
        self.client = client
        self.phonePilotClient = phonePilotClient

        do {
            credentials = try credentialsStore.load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    var isSignedIn: Bool {
        credentials != nil
    }

    var canOpenVoiceWorkspace: Bool {
        runtimeSafety?.canOpenVoiceWorkspace == true
    }

    var canStartPhonePilot: Bool {
        runtimeSafety?.canStartPhonePilot == true
            && phonePilotCall?.isActive != true
            && !isPhonePilotBusy
    }

    var hasActivePhonePilotCall: Bool {
        phonePilotCall?.isActive == true
    }

    func restoreSession() async {
        guard credentials != nil else {
            return
        }

        await refreshPhoneAssistant()
    }

    func signIn(username: String, password: String) async {
        do {
            let candidate = try PreviewCredentials(username: username, password: password)
            isRefreshing = true
            defer { isRefreshing = false }

            let safety = try await client.fetch(
                baseURL: workerBaseURL,
                credentials: candidate
            )
            try credentialsStore.save(candidate)
            credentials = candidate
            runtimeSafety = safety
            errorMessage = nil
            await refreshPhoneAssistant()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshPhoneAssistant() async {
        guard let credentials else {
            contacts = []
            recents = []
            selectedContactId = nil
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        await recoverCurrentPhonePilotCall()

        do {
            runtimeSafety = try await client.fetch(
                baseURL: workerBaseURL,
                credentials: credentials
            )
            contacts = try await phonePilotClient.listContacts(
                baseURL: workerBaseURL,
                credentials: credentials
            )
            recents = try await phonePilotClient.listRecents(
                baseURL: workerBaseURL,
                credentials: credentials
            )
            reconcileSelectedContact()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshSafety() async {
        guard let credentials else {
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        await recoverCurrentPhonePilotCall()

        do {
            runtimeSafety = try await client.fetch(
                baseURL: workerBaseURL,
                credentials: credentials
            )
            errorMessage = nil
        } catch {
            runtimeSafety = nil
            errorMessage = error.localizedDescription
        }
    }

    func startPhonePilot(
        destinationNumber: String,
        callObjective: String
    ) async {
        guard let credentials, canStartPhonePilot else {
            phonePilotErrorMessage =
                "Telephone calling is currently locked by safety settings."
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let start = try await phonePilotClient.start(
                baseURL: workerBaseURL,
                credentials: credentials,
                dialRequest: PhoneDialRequest(
                    destinationNumber: destinationNumber,
                    callObjective: callObjective
                )
            )
            phonePilotCall = PhonePilotCall(start: start)
            phonePilotErrorMessage = nil
        } catch {
            let recovered = await recoverCurrentPhonePilotCall()
            phonePilotErrorMessage =
                recovered ? nil : error.localizedDescription
        }
    }

    func startPhonePilotContact(
        contactId: String,
        callObjective: String
    ) async {
        guard let credentials, canStartPhonePilot else {
            phonePilotErrorMessage =
                "Telephone calling is currently locked by safety settings."
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let start = try await phonePilotClient.startContact(
                baseURL: workerBaseURL,
                credentials: credentials,
                contactId: contactId,
                callObjective: callObjective
            )
            selectedContactId = contactId
            phonePilotCall = PhonePilotCall(start: start)
            phonePilotErrorMessage = nil
        } catch {
            let recovered = await recoverCurrentPhonePilotCall()
            phonePilotErrorMessage =
                recovered ? nil : error.localizedDescription
        }
    }

    func startPhonePilotNewNumber(
        destinationNumber: String,
        displayName: String?,
        callObjective: String,
        saveContact: Bool
    ) async {
        guard let credentials, canStartPhonePilot else {
            phonePilotErrorMessage =
                "Telephone calling is currently locked by safety settings."
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let normalizedDisplayName = displayName?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let start = try await phonePilotClient.startNewNumber(
                baseURL: workerBaseURL,
                credentials: credentials,
                destinationNumber: destinationNumber,
                displayName: normalizedDisplayName?.isEmpty == true
                    ? nil
                    : normalizedDisplayName,
                callObjective: callObjective,
                saveContact: saveContact
            )
            phonePilotCall = PhonePilotCall(start: start)
            phonePilotErrorMessage = nil
        } catch {
            let recovered = await recoverCurrentPhonePilotCall()
            phonePilotErrorMessage =
                recovered ? nil : error.localizedDescription
        }
    }

    func startPhonePilotSelfTest() async {
        guard let credentials, canStartPhonePilot else {
            phonePilotErrorMessage =
                "Telephone calling is currently locked by safety settings."
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let start = try await phonePilotClient.startSelfTest(
                baseURL: workerBaseURL,
                credentials: credentials
            )
            phonePilotCall = PhonePilotCall(start: start)
            phonePilotErrorMessage = nil
        } catch {
            let recovered = await recoverCurrentPhonePilotCall()
            phonePilotErrorMessage =
                recovered ? nil : error.localizedDescription
        }
    }

    func startPhonePilotVerified(callObjective: String) async {
        guard let credentials, canStartPhonePilot else {
            phonePilotErrorMessage =
                "Telephone calling is currently locked by safety settings."
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let start = try await phonePilotClient.startVerified(
                baseURL: workerBaseURL,
                credentials: credentials,
                callObjective: callObjective
            )
            phonePilotCall = PhonePilotCall(start: start)
            phonePilotErrorMessage = nil
        } catch {
            let recovered = await recoverCurrentPhonePilotCall()
            phonePilotErrorMessage =
                recovered ? nil : error.localizedDescription
        }
    }

    @discardableResult
    private func recoverCurrentPhonePilotCall() async -> Bool {
        guard let credentials else {
            return false
        }

        do {
            let current = try await phonePilotClient.current(
                baseURL: workerBaseURL,
                credentials: credentials
            )

            if let recovered = current.call {
                phonePilotCall = PhonePilotCall(recovered: recovered)
                phonePilotErrorMessage = nil
                return true
            }

            if phonePilotCall?.isActive == true {
                phonePilotCall = nil
            }
            return false
        } catch {
            phonePilotErrorMessage = error.localizedDescription
            return false
        }
    }

    func monitorPhonePilotCall() async {
        while hasActivePhonePilotCall, !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(2))
            } catch {
                return
            }

            guard !Task.isCancelled, !isPhonePilotBusy else {
                continue
            }

            let didUpdate = await updatePhonePilotStatus()
            if !didUpdate {
                return
            }
        }
    }

    func stopPhonePilot() async {
        guard
            let credentials,
            let currentCall = phonePilotCall,
            currentCall.isActive,
            !isPhonePilotBusy
        else {
            return
        }

        isPhonePilotBusy = true
        defer { isPhonePilotBusy = false }

        do {
            let stop = try await phonePilotClient.stop(
                baseURL: workerBaseURL,
                credentials: credentials,
                leaseId: currentCall.leaseId
            )
            phonePilotCall?.apply(stop)
            phonePilotErrorMessage = nil
            await refreshPhoneAssistant()
        } catch {
            phonePilotErrorMessage = error.localizedDescription
        }
    }

    @discardableResult
    private func updatePhonePilotStatus() async -> Bool {
        guard
            let credentials,
            let currentCall = phonePilotCall,
            currentCall.isActive
        else {
            return false
        }

        do {
            let status = try await phonePilotClient.status(
                baseURL: workerBaseURL,
                credentials: credentials,
                leaseId: currentCall.leaseId
            )
            phonePilotCall?.apply(status)
            phonePilotErrorMessage = nil

            if status.terminal {
                await refreshPhoneAssistant()
            }
            return true
        } catch {
            phonePilotErrorMessage = error.localizedDescription
            return false
        }
    }

    func signOut() {
        guard !isPhonePilotBusy, !hasActivePhonePilotCall else {
            errorMessage =
                "End the telephone call before signing out so the emergency stop remains available."
            return
        }

        do {
            try credentialsStore.delete()
            credentials = nil
            runtimeSafety = nil
            phonePilotCall = nil
            contacts = []
            recents = []
            selectedContactId = nil
            errorMessage = nil
            phonePilotErrorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func reconcileSelectedContact() {
        guard !contacts.isEmpty else {
            selectedContactId = nil
            return
        }

        if
            let selectedContactId,
            contacts.contains(where: { $0.id == selectedContactId })
        {
            return
        }

        selectedContactId = contacts.first?.id
    }
}
