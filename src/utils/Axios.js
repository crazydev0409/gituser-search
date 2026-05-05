import axios from "axios";

const Axios = axios.create({
    baseURL: "/api/github",
});

export default Axios;
