import axios from "axios";

const Axios = axios.create({
    baseURL: "/api/github",
});

Axios.interceptors.request.use((config) => {
    const githubPath = config.url || "/";

    config.url = "";
    config.params = {
        ...(config.params || {}),
        path: githubPath.startsWith("/") ? githubPath : `/${githubPath}`,
    };

    return config;
});

export default Axios;
