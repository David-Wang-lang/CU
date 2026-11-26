//! Visible Windows service "CU Agent".
//! The service process has no window. It starts a capture process in the
//! logged-on user session so the real desktop can be recorded.
//! The service is listed in Services and can be stopped there.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use windows_service::define_windows_service;
use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
    ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, FALSE, HANDLE};
use windows_sys::Win32::Security::{DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS};
use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows_sys::Win32::System::RemoteDesktop::{WTSGetActiveConsoleSessionId, WTSQueryUserToken};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTF_USESHOWWINDOW,
    STARTUPINFOW,
};

const SERVICE_NAME: &str = "CUAgent";
const DISPLAY_NAME: &str = "CU Agent";
const DESCRIPTION: &str = "CU company device monitoring agent. Listed in Services; administrators can stop it there.";

define_windows_service!(ffi_service_main, service_main);

pub fn log_line(msg: &str) {
    let Ok(dir) = cu_agent_core::config_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("daemon.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {msg}", chrono::Utc::now().to_rfc3339());
    }
}

fn install_log(msg: &str) {
    let Ok(dir) = cu_agent_core::config_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("service-install.log"))
    {
        let _ = writeln!(file, "{} {msg}", chrono::Utc::now().to_rfc3339());
    }
}

pub fn install_service() -> i32 {
    match install_service_inner() {
        Ok(()) => {
            install_log("CU Agent service installed and started");
            0
        }
        Err(err) => {
            install_log(&err);
            1
        }
    }
}

fn install_service_inner() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Ok(dir) = cu_agent_core::config_dir() {
        let _ = fs::create_dir_all(&dir);
        let dir_str = dir.to_string_lossy().to_string();
        let _ = std::process::Command::new("icacls")
            .args([&dir_str, "/grant", "*S-1-5-32-545:(OI)(CI)M", "/T"])
            .status();
    }
    // Keep Astrill's AppInit DLL out of this process. It crashes Rust binaries
    // with an illegal instruction and is unrelated to hiding the service.
    let _ = block_appinit(&exe);

    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )
    .map_err(|e| format!("open service manager: {e}"))?;

    let info = service_info(&exe);
    let access = ServiceAccess::QUERY_STATUS
        | ServiceAccess::START
        | ServiceAccess::STOP
        | ServiceAccess::CHANGE_CONFIG;
    if let Ok(existing) = manager.open_service(SERVICE_NAME, access) {
        let _ = existing.stop();
        for _ in 0..20 {
            if let Ok(status) = existing.query_status() {
                if status.current_state == ServiceState::Stopped {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(250));
        }
        existing
            .change_config(&info)
            .map_err(|e| format!("update service: {e}"))?;
        let _ = existing.set_description(DESCRIPTION);
        existing
            .start::<String>(&[])
            .map_err(|e| format!("start service: {e}"))?;
    } else {
        let created = manager
            .create_service(&info, access)
            .map_err(|e| format!("create service: {e}"))?;
        let _ = created.set_description(DESCRIPTION);
        created
            .start::<String>(&[])
            .map_err(|e| format!("start service: {e}"))?;
    }
    let _ = std::process::Command::new("sc.exe")
        .args([
            "failure",
            SERVICE_NAME,
            "reset=",
            "86400",
            "actions=",
            "restart/5000",
        ])
        .status();
    Ok(())
}

fn service_info(exe: &PathBuf) -> ServiceInfo {
    ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe.clone(),
        launch_arguments: vec![],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    }
}

fn block_appinit(exe: &PathBuf) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_LOCAL_MACHINE, KEY_SET_VALUE,
        REG_BINARY, REG_OPTION_NON_VOLATILE,
    };
    let Some(name) = exe.file_name().and_then(|n| n.to_str()) else {
        return Ok(());
    };
    let subkey = format!(
        "Software\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\{name}"
    );
    let key_w: Vec<u16> = std::ffi::OsStr::new(&subkey).encode_wide().chain(Some(0)).collect();
    let value_w: Vec<u16> = std::ffi::OsStr::new("MitigationOptions")
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Extension-point disable: do not load AppInit DLLs such as ASProxy64.dll.
    let data: [u8; 16] = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    unsafe {
        let mut key = std::ptr::null_mut();
        let mut disp = 0u32;
        let rc = RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            key_w.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            &mut disp,
        );
        if rc != 0 {
            return Err(format!("registry create {rc}"));
        }
        let set = RegSetValueExW(
            key,
            value_w.as_ptr(),
            0,
            REG_BINARY,
            data.as_ptr(),
            data.len() as u32,
        );
        RegCloseKey(key);
        if set != 0 {
            return Err(format!("registry set {set}"));
        }
    }
    Ok(())
}

pub fn run_service() -> bool {
    match service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
        Ok(()) => true,
        Err(err) => {
            log_line(&format!("service dispatcher not used: {err}"));
            false
        }
    }
}

fn service_main(_arguments: Vec<OsString>) {
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let status_handle = match service_control_handler::register(SERVICE_NAME, move |control| {
        match control {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    }) {
        Ok(handle) => handle,
        Err(err) => {
            log_line(&format!("service handler failed: {err}"));
            return;
        }
    };

    let _ = status_handle.set_service_status(status(ServiceState::Running));
    log_line("CU Agent service running");
    supervise(shutdown_rx);
    log_line("CU Agent service stopped");
    let _ = status_handle.set_service_status(status(ServiceState::Stopped));
}

fn status(state: ServiceState) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(0),
        process_id: None,
    }
}

struct Worker {
    handle: HANDLE,
}

impl Worker {
    fn alive(&self) -> bool {
        unsafe {
            let mut code = 0u32;
            if GetExitCodeProcess(self.handle, &mut code) == 0 {
                return false;
            }
            code == 259
        }
    }

    fn close(self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }

    fn kill(self) {
        unsafe {
            TerminateProcess(self.handle, 0);
            WaitForSingleObject(self.handle, 5000);
            CloseHandle(self.handle);
        }
    }
}

fn supervise(shutdown: mpsc::Receiver<()>) {
    let mut worker: Option<Worker> = None;
    let mut backoff_until = None::<std::time::Instant>;
    loop {
        match shutdown.recv_timeout(Duration::from_secs(2)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(worker) = worker.take() {
                    worker.kill();
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if backoff_until.is_some_and(|until| std::time::Instant::now() < until) {
                    continue;
                }
                if let Some(current) = worker.take() {
                    if current.alive() {
                        worker = Some(current);
                        continue;
                    }
                    current.close();
                }
                match spawn_capture_process() {
                    Ok(Some(child)) => {
                        log_line("started capture process in the active user session");
                        worker = Some(child);
                    }
                    Ok(None) => {}
                    Err(err) => {
                        log_line(&format!("capture start failed: {err}"));
                        backoff_until = Some(std::time::Instant::now() + Duration::from_secs(15));
                    }
                }
            }
        }
    }
}

fn spawn_capture_process() -> Result<Option<Worker>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    unsafe {
        let session = WTSGetActiveConsoleSessionId();
        if session == 0xFFFFFFFF {
            return Ok(None);
        }
        let mut user_token: HANDLE = std::ptr::null_mut();
        if WTSQueryUserToken(session, &mut user_token) == FALSE {
            return Ok(None);
        }
        let mut primary: HANDLE = std::ptr::null_mut();
        let dup = DuplicateTokenEx(
            user_token,
            TOKEN_ALL_ACCESS,
            std::ptr::null(),
            SecurityImpersonation,
            TokenPrimary,
            &mut primary,
        );
        CloseHandle(user_token);
        if dup == FALSE {
            return Err(format!("DuplicateTokenEx {}", GetLastError()));
        }
        let mut env = std::ptr::null_mut();
        if CreateEnvironmentBlock(&mut env, primary, FALSE) == FALSE {
            env = std::ptr::null_mut();
        }
        let mut desktop: Vec<u16> = wide("winsta0\\default");
        let cmdline = format!("\"{}\" --capture", exe.display());
        let mut cmdline_w = wide(&cmdline);
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.lpDesktop = desktop.as_mut_ptr();
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = 0;
        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
        let ok = CreateProcessAsUserW(
            primary,
            std::ptr::null(),
            cmdline_w.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            FALSE,
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            env,
            std::ptr::null(),
            &si,
            &mut pi,
        );
        let err = GetLastError();
        if !env.is_null() {
            DestroyEnvironmentBlock(env);
        }
        CloseHandle(primary);
        if ok == FALSE {
            return Err(format!("CreateProcessAsUser {err}"));
        }
        CloseHandle(pi.hThread);
        Ok(Some(Worker { handle: pi.hProcess }))
    }
}

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
}
